-- Finalização operacional: materiais, conhecimento, agenda, takeover e observabilidade.
begin;
alter type public.appointment_status add value if not exists 'requested';
alter type public.appointment_status add value if not exists 'proposed';
alter type public.appointment_status add value if not exists 'confirmed';
alter type public.appointment_status add value if not exists 'rescheduled';

alter table public.materials
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.material_send_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  material_name text not null,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  mode text not null check (mode in ('automatic','manual','simulation')),
  status text not null check (status in ('requested','sent','failed','blocked')),
  reason text,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.knowledge_items
  add column if not exists subject text not null default '',
  add column if not exists stages text[] not null default '{}',
  add column if not exists archived_at timestamptz;

alter table public.appointments
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists origin text not null default 'manual' check (origin in ('ai','manual')),
  add column if not exists reminder_at timestamptz,
  add column if not exists rescheduled_from uuid references public.appointments(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.appointment_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  action text not null,
  previous_status text,
  next_status text,
  details jsonb not null default '{}',
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.conversations
  add column if not exists takeover_state text not null default 'ai_active'
    check (takeover_state in ('ai_active','human_requested','human_active','ai_paused','returned_to_ai','closed'));

create table if not exists public.conversation_takeovers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  state text not null check (state in ('ai_active','human_requested','human_active','ai_paused','returned_to_ai','closed')),
  reason text not null default '',
  notes text not null default '',
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('lead_replied','lead_interested','call_requested','demo_requested','demo_scheduled','complaint','aggressive_message','low_confidence','groq_error','whatsapp_disconnected','worker_stopped','daily_limit_reached','queue_failed','material_missing','opt_out_send_attempt')),
  level text not null default 'info' check (level in ('info','warning','critical')),
  title text not null,
  body text not null default '',
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  entity_id uuid,
  dedup_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists level text not null default 'info',
  add column if not exists service text not null default 'api',
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists job_id uuid,
  add column if not exists integration text,
  add column if not exists event_type text;

create index if not exists materials_owner_active_idx on public.materials(owner_id, active, archived_at);
create index if not exists material_send_history_owner_created_idx on public.material_send_history(owner_id, created_at desc);
create index if not exists knowledge_search_idx on public.knowledge_items using gin (to_tsvector('portuguese', coalesce(title,'') || ' ' || coalesce(subject,'') || ' ' || coalesce(content,'')));
create index if not exists appointments_owner_time_idx on public.appointments(owner_id, starts_at, ends_at);
create index if not exists appointment_history_appointment_idx on public.appointment_history(appointment_id, created_at desc);
create index if not exists takeover_conversation_idx on public.conversation_takeovers(conversation_id, created_at desc);
create unique index if not exists notifications_owner_dedup_idx on public.notifications(owner_id, dedup_key) where dedup_key is not null;
create index if not exists notifications_owner_unread_idx on public.notifications(owner_id, read_at, created_at desc);
create index if not exists audit_logs_operational_idx on public.audit_logs(owner_id, created_at desc, level, service);

alter table public.material_send_history enable row level security;
alter table public.appointment_history enable row level security;
alter table public.conversation_takeovers enable row level security;
alter table public.notifications enable row level security;

drop policy if exists material_send_history_owner on public.material_send_history;
create policy material_send_history_owner on public.material_send_history for select using (owner_id = auth.uid());
drop policy if exists appointment_history_owner on public.appointment_history;
create policy appointment_history_owner on public.appointment_history for select using (owner_id = auth.uid());
drop policy if exists conversation_takeovers_owner on public.conversation_takeovers;
create policy conversation_takeovers_owner on public.conversation_takeovers for select using (owner_id = auth.uid());
drop policy if exists notifications_owner on public.notifications;
create policy notifications_owner on public.notifications for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.record_appointment_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_history(owner_id,appointment_id,action,next_status,details,actor_id)
    values(new.owner_id,new.id,'created',new.status::text,jsonb_build_object('startsAt',new.starts_at,'endsAt',new.ends_at),auth.uid());
  elsif old.status is distinct from new.status or old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at then
    insert into public.appointment_history(owner_id,appointment_id,action,previous_status,next_status,details,actor_id)
    values(new.owner_id,new.id,case when old.starts_at is distinct from new.starts_at then 'rescheduled' else 'status_changed' end,old.status::text,new.status::text,jsonb_build_object('previousStartsAt',old.starts_at,'startsAt',new.starts_at,'endsAt',new.ends_at),auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists appointments_history_trigger on public.appointments;
create trigger appointments_history_trigger after insert or update on public.appointments for each row execute function public.record_appointment_history();

create or replace function public.prevent_appointment_conflict() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status::text in ('cancelled','completed','no_show') then return new; end if;
  if exists (
    select 1 from public.appointments other
    where other.owner_id = new.owner_id and other.id <> new.id
      and other.status::text not in ('cancelled','completed','no_show')
      and (new.assignee = '' or other.assignee = '' or other.assignee = new.assignee)
      and tstzrange(other.starts_at,other.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')
  ) then raise exception 'Conflito de horário para o closer selecionado.' using errcode = '23P01'; end if;
  return new;
end $$;
drop trigger if exists appointments_conflict_trigger on public.appointments;
create trigger appointments_conflict_trigger before insert or update on public.appointments for each row execute function public.prevent_appointment_conflict();

create or replace function public.audit_to_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_title text; v_level text := 'info';
begin
  v_type := case
    when new.action in ('message.inbound.received','message.inbound.processed') then 'lead_replied'
    when new.action = 'lead.interested' then 'lead_interested'
    when new.action = 'lead.call_requested' then 'call_requested'
    when new.action = 'appointment.requested' then 'demo_requested'
    when new.action in ('appointment.created','appointment.confirmed') then 'demo_scheduled'
    when new.action = 'lead.complaint' then 'complaint'
    when new.action = 'message.aggressive' then 'aggressive_message'
    when new.action = 'agent.low_confidence' then 'low_confidence'
    when new.action like 'groq.%failed%' or new.action in ('groq.rate_limited','groq.model_unavailable') then 'groq_error'
    when new.action = 'whatsapp.disconnected' then 'whatsapp_disconnected'
    when new.action = 'worker.stopped' then 'worker_stopped'
    when new.action = 'outreach.daily_limit_reached' then 'daily_limit_reached'
    when new.action in ('queue.failed','queue.dead_letter') then 'queue_failed'
    when new.action = 'material.missing' then 'material_missing'
    when new.action = 'optout.send_blocked' then 'opt_out_send_attempt'
  end;
  if v_type is null then return new; end if;
  v_level := case when v_type in ('groq_error','whatsapp_disconnected','worker_stopped','queue_failed','opt_out_send_attempt') then 'critical' when v_type in ('complaint','aggressive_message','low_confidence','daily_limit_reached','material_missing') then 'warning' else 'info' end;
  v_title := replace(initcap(replace(v_type,'_',' ')), 'Groq', 'Groq');
  insert into public.notifications(owner_id,type,level,title,body,lead_id,conversation_id,entity_id)
  values(new.owner_id,v_type,v_level,v_title,left(coalesce(new.details->>'message',new.action),500),new.lead_id,new.conversation_id,new.entity_id);
  return new;
end $$;
drop trigger if exists audit_notification_trigger on public.audit_logs;
create trigger audit_notification_trigger after insert on public.audit_logs for each row execute function public.audit_to_notification();
commit;
