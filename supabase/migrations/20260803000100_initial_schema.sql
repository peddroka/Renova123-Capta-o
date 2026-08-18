begin;

create extension if not exists pgcrypto with schema extensions;

create type public.lead_stage as enum ('new','queued','contacted','engaged','interested','demo_scheduled','human_handoff','won','lost','opted_out');
create type public.job_status as enum ('pending','processing','completed','failed','dead','cancelled');
create type public.message_status as enum ('queued','simulated','sent','delivered','read','received','failed');
create type public.appointment_status as enum ('pending','scheduled','completed','cancelled','no_show');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Administrador',
  role text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lead_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  source text not null check (length(trim(source)) between 2 and 200),
  context text not null default '',
  notes text not null default '',
  initial_strategy text not null default '',
  authorized boolean not null check (authorized),
  priority smallint not null default 5 check (priority between 1 and 10),
  start_date date not null default current_date,
  daily_limit integer check (daily_limit > 0 and daily_limit <= 10000),
  status text not null default 'scheduled' check (status in ('draft','scheduled','active','paused','completed','cancelled')),
  total_count integer not null default 0,
  processed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid references public.lead_batches(id) on delete set null,
  phone text not null check (phone ~ '^55[0-9]{10,11}$'),
  name text,
  company text,
  source text not null default '',
  stage public.lead_stage not null default 'new',
  automation_paused boolean not null default false,
  human_active boolean not null default false,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  approached_at timestamptz,
  last_contact_at timestamptz,
  opted_out_at timestamptz,
  lost_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, phone)
);

create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^55[0-9]{10,11}$'),
  reason text not null,
  source text not null default 'manual',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(phone)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','closed')),
  stage public.lead_stage not null default 'engaged',
  human_active boolean not null default false,
  summary text not null default '',
  detected_objections jsonb not null default '[]'::jsonb,
  provided_information jsonb not null default '[]'::jsonb,
  last_message_at timestamptz,
  locked_until timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  sender_type text not null check (sender_type in ('lead','agent','human','system')),
  content text not null default '',
  message_type text not null default 'text' check (message_type in ('text','image','video','audio','document')),
  external_id text,
  idempotency_key text,
  status public.message_status not null,
  error_message text,
  raw_data jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index messages_external_id_unique on public.messages(external_id) where external_id is not null;
create unique index messages_idempotency_unique on public.messages(idempotency_key) where idempotency_key is not null;

create table public.lead_memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  key text not null check (length(key) <= 100),
  value text not null check (length(value) <= 1000),
  source text not null default 'ai' check (source in ('ai','human','import')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lead_id, key)
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  category text not null,
  tags text[] not null default '{}',
  storage_path text not null unique,
  allowed_stages public.lead_stage[] not null default '{}',
  related_intent text,
  instruction text not null default '',
  active boolean not null default true,
  auto_send_allowed boolean not null default false,
  human_confirmation_required boolean not null default true,
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  mime_type text not null,
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), start_time time not null, end_time time not null,
  duration_minutes integer not null default 45 check (duration_minutes between 15 and 240), buffer_minutes integer not null default 15 check (buffer_minutes between 0 and 120),
  min_notice_hours integer not null default 24 check (min_notice_hours between 0 and 720), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id, weekday, start_time)
);

create table public.blocked_slots (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at), reason text,
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade, starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  status public.appointment_status not null default 'scheduled', assignee text not null default '', notes text not null default '',
  cancelled_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index appointments_active_window_idx on public.appointments(starts_at, ends_at) where status in ('pending','scheduled');

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade, scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','processing','completed','cancelled','failed')),
  attempt_number integer not null default 1 check (attempt_number between 1 and 20), reason text not null default '', recommendation jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.handoffs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade, reason text not null,
  status text not null default 'pending' check (status in ('pending','active','returned','closed')),
  assigned_to text, result text, assumed_at timestamptz, closed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.initial_messages (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null, content text not null check (length(trim(content)) between 10 and 2000), active boolean not null default true,
  use_count integer not null default 0, last_used_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.system_settings (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  section text not null check (section in ('general','outreach','mind','groq','whatsapp','appointments')), values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id, section)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('outreach','inbound_reply','follow_up','send_material','opt_out','appointment_reminder')),
  payload jsonb not null default '{}'::jsonb, status public.job_status not null default 'pending', attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20), available_at timestamptz not null default now(),
  locked_at timestamptz, locked_by text, completed_at timestamptz, last_error text, idempotency_key text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index jobs_idempotency_unique on public.jobs(idempotency_key) where idempotency_key is not null;
create index jobs_claim_idx on public.jobs(status, available_at, created_at) where status = 'pending';
create index jobs_stale_idx on public.jobs(status, locked_at) where status = 'processing';

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(), event_id text not null unique, event_type text not null,
  payload jsonb not null, received_at timestamptz not null default now(), processed_at timestamptz
);

create table public.delivery_receipts (
  id uuid primary key default gen_random_uuid(), message_id uuid references public.messages(id) on delete cascade,
  external_id text, status public.message_status not null, payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), unique(external_id, status)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null, action text not null, entity_type text not null, entity_id text,
  details jsonb not null default '{}'::jsonb, ip inet, user_agent text, created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end $$;

do $$ declare item text; begin
  foreach item in array array['profiles','lead_batches','leads','suppression_list','conversations','lead_memories','materials','availability_rules','appointments','follow_ups','handoffs','initial_messages','system_settings','jobs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', item || '_updated_at', item);
  end loop;
end $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name','Administrador')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
create policy profiles_admin_select on public.profiles for select to authenticated using (public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated using (id=auth.uid() and public.is_admin()) with check (id=auth.uid() and public.is_admin());

do $$ declare item text; begin
  foreach item in array array['lead_batches','leads','suppression_list','conversations','messages','lead_memories','materials','availability_rules','blocked_slots','appointments','follow_ups','handoffs','initial_messages','system_settings','jobs','audit_logs'] loop
    execute format('alter table public.%I enable row level security', item);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', item || '_admin_select', item);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin() and (owner_id is null or owner_id = auth.uid()))', item || '_admin_insert', item);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin() and (owner_id is null or owner_id = auth.uid()))', item || '_admin_update', item);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', item || '_admin_delete', item);
  end loop;
end $$;

alter table public.webhook_events enable row level security;
alter table public.delivery_receipts enable row level security;
revoke all on public.webhook_events, public.delivery_receipts from anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('materials','materials',false,26214400,array[
  'image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','audio/mpeg','audio/ogg','audio/mp4',
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy materials_admin_read on storage.objects for select to authenticated using (bucket_id='materials' and public.is_admin());
create policy materials_admin_insert on storage.objects for insert to authenticated with check (bucket_id='materials' and public.is_admin());
create policy materials_admin_update on storage.objects for update to authenticated using (bucket_id='materials' and public.is_admin()) with check (bucket_id='materials' and public.is_admin());
create policy materials_admin_delete on storage.objects for delete to authenticated using (bucket_id='materials' and public.is_admin());

create index leads_stage_idx on public.leads(owner_id, stage, created_at desc);
create index leads_contact_idx on public.leads(owner_id, last_contact_at desc);
create index messages_lead_idx on public.messages(lead_id, created_at);
create index conversations_recent_idx on public.conversations(owner_id, last_message_at desc);
create index follow_ups_due_idx on public.follow_ups(status, scheduled_at) where status='scheduled';

commit;
