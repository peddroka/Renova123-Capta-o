begin;

-- Canonical agent identity. This is deliberately separate from agent_profiles:
-- profiles/instructions are content; agents are the operational isolation scope.
create table if not exists public.agents (
  agent_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z0-9_-]{1,49}$'),
  name text not null,
  status text not null default 'active' check (status in ('active','paused','archived')),
  daily_limit integer not null default 50 check (daily_limit > 0 and daily_limit <= 10000),
  operational_start time not null default '08:00',
  operational_end time not null default '23:00',
  timezone text not null default 'America/Sao_Paulo',
  automation_enabled boolean not null default false,
  global_pause boolean not null default false,
  outreach_enabled boolean not null default false,
  real_sending_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, slug),
  check (operational_end > operational_start)
);

create index if not exists agents_owner_status_idx on public.agents(owner_id, status, slug);

-- Existing operational data belongs to Francisco. The trigger makes old write
-- paths safe while callers are incrementally migrated to an explicit agent_id.
insert into public.agents(owner_id, slug, name, status, daily_limit, operational_start, operational_end, timezone,
  automation_enabled, global_pause, outreach_enabled, real_sending_enabled)
select p.id, 'francisco', 'Francisco', 'active',
  coalesce(nullif((o.values->>'dailyLimit')::integer, 0), 50),
  coalesce(nullif(o.values->>'startTime','')::time, '08:00'),
  coalesce(nullif(o.values->>'endTime','')::time, '23:00'),
  coalesce(nullif(o.values->>'timezone',''), 'America/Sao_Paulo'),
  coalesce((g.values->>'automationEnabled')::boolean, false),
  coalesce((g.values->>'globalPause')::boolean, false),
  coalesce((o.values->>'enabled')::boolean, false),
  coalesce((g.values->>'realSendingEnabled')::boolean, false)
from public.profiles p
left join public.app_settings o on o.owner_id=p.id and o.section='outreach'
left join public.app_settings g on g.owner_id=p.id and g.section='general'
on conflict(owner_id, slug) do nothing;

insert into public.agents(owner_id, slug, name, status, daily_limit, operational_start, operational_end, timezone,
  automation_enabled, global_pause, outreach_enabled, real_sending_enabled)
select p.id, 'pedro', 'Pedro', 'paused', 50, '08:00', '17:00', 'America/Sao_Paulo', false, true, false, false
from public.profiles p
on conflict(owner_id, slug) do update set
  name='Pedro', status='paused', daily_limit=50, operational_start='08:00', operational_end='17:00',
  timezone='America/Sao_Paulo', automation_enabled=false, global_pause=true,
  outreach_enabled=false, real_sending_enabled=false, updated_at=now();

create or replace function public.fill_agent_scope() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.agent_id is null then
    select a.agent_id into new.agent_id from public.agents a
      where a.owner_id = new.owner_id and a.slug = 'francisco' limit 1;
  end if;
  if new.agent_id is null then raise exception 'agent scope is required for %', tg_table_name; end if;
  return new;
end $$;

-- Keep operational state in the existing tables; no per-agent table copies.
do $$
declare t text;
begin
  foreach t in array array[
    'lead_batches','leads','suppression_list','conversations','messages','lead_memories',
    'materials','availability_rules','blocked_slots','appointments','follow_ups','handoffs',
    'initial_messages','system_settings','app_settings','system_secrets_metadata','agent_profiles',
    'agent_instructions','knowledge_items','knowledge_files','message_templates','lead_batch_members',
    'lead_events','conversation_memories','outreach_queue','ai_response_queue','follow_up_queue',
    'availability_blocks','daily_usage','integration_connections','integration_events','worker_heartbeats',
    'failed_jobs','agent_executions','material_send_history','appointment_history','conversation_takeovers',
    'notifications','outreach_cadence_state','sales_handoff_deliveries','daily_cadence_plans','audit_logs',
    'wolf_lead_state','wolf_call_events'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists agent_id uuid', t);
      execute format('update public.%I x set agent_id=a.agent_id from public.agents a where x.agent_id is null and x.owner_id=a.owner_id and a.slug=''francisco''', t);
      execute format('alter table public.%I alter column agent_id set not null', t);
      execute format('alter table public.%I add constraint %I foreign key (agent_id) references public.agents(agent_id) on delete restrict', t, t||'_agent_fk');
      execute format('create index if not exists %I on public.%I(agent_id)', t||'_agent_idx', t);
      execute format('drop trigger if exists %I on public.%I', t||'_fill_agent_scope', t);
      execute format('create trigger %I before insert on public.%I for each row execute function public.fill_agent_scope()', t||'_fill_agent_scope', t);
    end if;
  end loop;
end $$;

-- Phone uniqueness is scoped to an agent, allowing the same number in two
-- independent agent campaigns without sharing lead/conversation context.
drop index if exists public.leads_owner_id_phone_key;
create unique index if not exists leads_agent_phone_unique on public.leads(owner_id, agent_id, phone);
drop index if exists public.suppression_list_phone_key;
create unique index if not exists suppression_agent_phone_unique on public.suppression_list(owner_id, agent_id, phone);

create or replace function public.claim_queue_items_for_agent(
  p_queue text, p_agent_slug text, p_limit integer, p_worker_id text
)
returns table(queue_name text,id uuid,owner_id uuid,agent_id uuid,payload jsonb,attempts integer,max_attempts integer,deduplication_key text)
language plpgsql security definer set search_path=public as $$
declare v_agent uuid;
begin
  select a.agent_id into v_agent from public.agents a where a.slug=p_agent_slug and a.status='active';
  if v_agent is null then return; end if;
  if p_queue not in ('outreach_queue','ai_response_queue','follow_up_queue') then raise exception 'invalid queue'; end if;
  return query execute format($query$
    with claimed as (
      select q.id from public.%I q
      where q.agent_id=$1 and q.status in ('pending','scheduled','retry') and q.available_at<=now() and q.attempts<q.max_attempts
      order by q.priority,q.available_at,q.created_at for update skip locked limit $2
    )
    update public.%I q set status='processing',locked_at=now(),locked_by=left($3,120),attempts=q.attempts+1,updated_at=now()
    from claimed where q.id=claimed.id
    returning %L::text,q.id,q.owner_id,q.agent_id,q.payload,q.attempts,q.max_attempts,q.deduplication_key
  $query$,p_queue,p_queue,p_queue) using v_agent, least(greatest(p_limit,1),100), p_worker_id;
end $$;
revoke all on function public.claim_queue_items_for_agent(text,text,integer,text) from public,anon,authenticated;
grant execute on function public.claim_queue_items_for_agent(text,text,integer,text) to service_role;

-- Compatibility callers remain Francisco-scoped. This fail-closed default is
-- what prevents an un-upgraded worker from consuming Pedro's queue.
create or replace function public.claim_queue_items(p_queue text,p_limit integer,p_worker_id text)
returns table(queue_name text,id uuid,owner_id uuid,payload jsonb,attempts integer,max_attempts integer,deduplication_key text)
language plpgsql security definer set search_path=public as $$
begin
  return query execute format($query$
    with claimed as (
      select q.id from public.%I q join public.agents a on a.agent_id=q.agent_id
      where a.slug='francisco' and a.status='active' and q.status in ('pending','scheduled','retry')
        and q.available_at<=now() and q.attempts<q.max_attempts
      order by q.priority,q.available_at,q.created_at for update skip locked limit $1
    )
    update public.%I q set status='processing',locked_at=now(),locked_by=left($2,120),attempts=q.attempts+1,updated_at=now()
    from claimed where q.id=claimed.id
    returning %L::text,q.id,q.owner_id,q.payload,q.attempts,q.max_attempts,q.deduplication_key
  $query$,p_queue,p_queue,p_queue) using least(greatest(p_limit,1),100),p_worker_id;
end $$;
revoke all on function public.claim_queue_items(text,integer,text) from public,anon,authenticated;
grant execute on function public.claim_queue_items(text,integer,text) to service_role;

create or replace function public.claim_jobs(p_owner uuid,p_limit integer,p_worker_id text)
returns table(id uuid,type text,payload jsonb,attempts integer,max_attempts integer)
language plpgsql security definer set search_path=public as $$
begin
  return query with claimed as (
    select j.id from public.jobs j join public.agents a on a.agent_id=j.agent_id
    where j.owner_id=p_owner and a.slug='francisco' and a.status='active' and j.status='pending'
      and j.available_at<=now() and j.attempts<j.max_attempts
    order by case j.type when 'opt_out' then 0 when 'inbound_reply' then 1 else 2 end,j.available_at,j.created_at
    for update skip locked limit least(greatest(p_limit,1),50)
  ), updated as (
    update public.jobs j set status='processing',locked_at=now(),locked_by=left(p_worker_id,160),attempts=j.attempts+1,updated_at=now()
    from claimed where j.id=claimed.id returning j.*
  ) select updated.id,updated.type,updated.payload,updated.attempts,updated.max_attempts from updated;
end $$;
revoke all on function public.claim_jobs(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.claim_jobs(uuid,integer,text) to service_role;

create or replace function public.reserve_agent_outreach_quota(p_agent uuid, p_daily_limit integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_day date; v_count integer;
begin
  select (now() at time zone a.timezone)::date into v_day from public.agents a where a.agent_id=p_agent and a.status='active' and not a.global_pause;
  if v_day is null then return jsonb_build_object('allowed',false,'reason','Agente pausado'); end if;
  insert into public.daily_usage(owner_id,agent_id,usage_date) select owner_id,p_agent,v_day from public.agents where agent_id=p_agent on conflict(agent_id,usage_date) do nothing;
  select outreach_count into v_count from public.daily_usage where agent_id=p_agent and usage_date=v_day for update;
  if coalesce(v_count,0)>=greatest(0,p_daily_limit) then return jsonb_build_object('allowed',false,'reason','Limite diário do agente atingido'); end if;
  update public.daily_usage set outreach_count=outreach_count+1,updated_at=now() where agent_id=p_agent and usage_date=v_day;
  return jsonb_build_object('allowed',true,'reason',null);
end $$;
revoke all on function public.reserve_agent_outreach_quota(uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_agent_outreach_quota(uuid,integer) to service_role;

alter table public.agents enable row level security;
create policy agents_admin_select on public.agents for select to authenticated using (public.is_admin() and owner_id=auth.uid());
create policy agents_admin_update on public.agents for update to authenticated using (public.is_admin() and owner_id=auth.uid()) with check (public.is_admin() and owner_id=auth.uid());

commit;
