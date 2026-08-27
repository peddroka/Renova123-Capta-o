begin;

-- Francisco proactive pacing: every automatic proactive/follow-up send must wait
-- a hard 6-minute floor and only then add a randomized 1-10 minute delay.
-- This is intentionally fail-closed: a reservation is persisted before transport
-- so concurrent/restarted workers cannot create a burst.
alter table public.daily_usage add column if not exists proactive_hard_floor_minutes integer;
alter table public.daily_usage add column if not exists proactive_jitter_minutes integer;

-- The multi-agent migration is a prerequisite. Keep usage isolated per agent
-- instead of silently sharing the legacy owner/day row between agents.
alter table public.daily_usage drop constraint if exists daily_usage_owner_id_usage_date_key;
drop index if exists public.daily_usage_owner_id_usage_date_key;
create unique index if not exists daily_usage_agent_id_usage_date_key
  on public.daily_usage(agent_id, usage_date);

create or replace function public.reserve_agent_proactive_pacing(
  p_agent_slug text default 'francisco',
  p_hard_floor_minutes integer default 6,
  p_jitter_min_minutes integer default 1,
  p_jitter_max_minutes integer default 10
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_agent public.agents%rowtype;
  v_day date;
  v_next timestamptz;
  v_last timestamptz;
  v_jitter integer;
  v_total integer;
begin
  if p_hard_floor_minutes < 6 then
    raise exception 'hard proactive floor cannot be below 6 minutes';
  end if;
  if p_jitter_min_minutes < 1 or p_jitter_max_minutes < p_jitter_min_minutes then
    raise exception 'invalid proactive jitter interval';
  end if;

  select * into v_agent
    from public.agents
   where slug = p_agent_slug and status = 'active'
   order by created_at
   limit 1;
  if v_agent.agent_id is null then
    return jsonb_build_object('allowed',false,'reason','agent_not_active','retryAt',now()+interval '5 minutes');
  end if;

  v_day := (now() at time zone v_agent.timezone)::date;
  insert into public.daily_usage(owner_id,agent_id,usage_date)
  values(v_agent.owner_id,v_agent.agent_id,v_day)
  on conflict(agent_id,usage_date) do nothing;

  select next_outreach_at,last_proactive_send_at
    into v_next,v_last
    from public.daily_usage
   where agent_id=v_agent.agent_id and usage_date=v_day
   for update;

  if v_next is not null and v_next > now() then
    return jsonb_build_object(
      'allowed',false,
      'reason','waiting_for_pacing',
      'retryAt',v_next,
      'lastProactiveSendAt',v_last
    );
  end if;

  v_jitter := p_jitter_min_minutes + floor(random() * (p_jitter_max_minutes - p_jitter_min_minutes + 1))::integer;
  v_total := p_hard_floor_minutes + v_jitter;
  v_next := now() + make_interval(mins => v_total);

  update public.daily_usage
     set next_outreach_at=v_next,
         proactive_interval_minutes=v_total,
         proactive_hard_floor_minutes=p_hard_floor_minutes,
         proactive_jitter_minutes=v_jitter,
         updated_at=now()
   where owner_id=v_agent.owner_id and usage_date=v_day;

  return jsonb_build_object(
    'allowed',true,
    'reason',null,
    'retryAt',v_next,
    'intervalMinutes',v_total,
    'hardFloorMinutes',p_hard_floor_minutes,
    'jitterMinutes',v_jitter,
    'lastProactiveSendAt',v_last
  );
end $$;

create or replace function public.mark_agent_proactive_sent(
  p_agent_slug text default 'francisco',
  p_sent_at timestamptz default now()
)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_agent public.agents%rowtype;
  v_day date;
begin
  select * into v_agent from public.agents where slug=p_agent_slug order by created_at limit 1;
  if v_agent.agent_id is null then return; end if;
  v_day := (p_sent_at at time zone v_agent.timezone)::date;
  insert into public.daily_usage(owner_id,agent_id,usage_date)
  values(v_agent.owner_id,v_agent.agent_id,v_day)
  on conflict(agent_id,usage_date) do nothing;
  update public.daily_usage
     set last_proactive_send_at=p_sent_at,
         next_outreach_at=greatest(
           coalesce(next_outreach_at,p_sent_at),
           p_sent_at + make_interval(mins => coalesce(proactive_hard_floor_minutes,6) + coalesce(proactive_jitter_minutes,1))
         ),
         updated_at=now()
   where agent_id=v_agent.agent_id and usage_date=v_day;
end $$;

revoke all on function public.reserve_agent_proactive_pacing(text,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.mark_agent_proactive_sent(text,timestamptz) from public,anon,authenticated;
grant execute on function public.reserve_agent_proactive_pacing(text,integer,integer,integer) to service_role;
grant execute on function public.mark_agent_proactive_sent(text,timestamptz) to service_role;

-- Keep the visible settings canonical. min/max are retained for compatibility,
-- but the new fields make the semantics explicit: 6-minute absolute floor + 1-10 jitter.
update public.app_settings
   set values = values || '{"proactiveHardFloorMinutes":6,"proactiveJitterMinMinutes":1,"proactiveJitterMaxMinutes":10,"minIntervalMinutes":7,"maxIntervalMinutes":16}'::jsonb,
       updated_at=now()
 where section='outreach';
update public.system_settings
   set values = values || '{"proactiveHardFloorMinutes":6,"proactiveJitterMinMinutes":1,"proactiveJitterMaxMinutes":10,"minIntervalMinutes":7,"maxIntervalMinutes":16}'::jsonb,
       updated_at=now()
 where section='outreach';

-- Personal manual call desk. It is deliberately independent from automated
-- outreach queues: it tracks human calls, outcomes, notes, callbacks and goals.
create table if not exists public.manual_call_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  daily_goal integer not null default 100 check(daily_goal between 1 and 1000),
  timezone text not null default 'America/Sao_Paulo',
  updated_at timestamptz not null default now()
);

create table if not exists public.manual_call_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sequence_no bigint not null,
  phone text not null check(phone ~ '^55[0-9]{10,11}$'),
  name text,
  company text,
  source text,
  status text not null default 'pending' check(status in ('pending','in_progress','callback','completed','skipped')),
  outcome text check(outcome is null or outcome in ('no_answer','busy','voicemail','wrong_number','no_interest','interested','qualified','callback','other')),
  notes text not null default '',
  attempt_count integer not null default 0 check(attempt_count >= 0),
  last_started_at timestamptz,
  called_at timestamptz,
  callback_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,sequence_no)
);
create index if not exists manual_call_queue_owner_status_sequence_idx on public.manual_call_queue(owner_id,status,sequence_no);
create index if not exists manual_call_queue_owner_callback_idx on public.manual_call_queue(owner_id,callback_at) where status='callback';
create index if not exists manual_call_queue_owner_phone_idx on public.manual_call_queue(owner_id,phone);

create table if not exists public.manual_call_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.manual_call_queue(id) on delete cascade,
  outcome text not null,
  notes text not null default '',
  called_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists manual_call_events_owner_called_idx on public.manual_call_events(owner_id,called_at desc);

create or replace function public.append_manual_call_queue(p_owner uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_seq bigint;
  v_item jsonb;
  v_phone text;
  v_inserted integer := 0;
  v_skipped integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be an array'; end if;
  perform pg_advisory_xact_lock(hashtext('manual_call_queue:'||p_owner::text));
  select coalesce(max(sequence_no),0) into v_seq from public.manual_call_queue where owner_id=p_owner;
  for v_item in select * from jsonb_array_elements(p_rows) loop
    v_phone := regexp_replace(coalesce(v_item->>'phone',''),'\D','','g');
    if v_phone !~ '^55[0-9]{10,11}$' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if exists(
      select 1 from public.manual_call_queue
       where owner_id=p_owner and phone=v_phone and status in ('pending','in_progress','callback')
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_seq := v_seq + 1;
    insert into public.manual_call_queue(owner_id,sequence_no,phone,name,company,source)
    values(p_owner,v_seq,v_phone,nullif(v_item->>'name',''),nullif(v_item->>'company',''),nullif(v_item->>'source',''));
    v_inserted := v_inserted + 1;
  end loop;
  insert into public.manual_call_settings(owner_id) values(p_owner) on conflict(owner_id) do nothing;
  return jsonb_build_object('inserted',v_inserted,'skipped',v_skipped,'lastSequence',v_seq);
end $$;
revoke all on function public.append_manual_call_queue(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.append_manual_call_queue(uuid,jsonb) to service_role;

create or replace function public.complete_manual_call(
  p_owner uuid,
  p_task uuid,
  p_outcome text,
  p_notes text default '',
  p_callback_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_task public.manual_call_queue%rowtype;
  v_now timestamptz := now();
  v_status text;
begin
  if p_outcome not in ('no_answer','busy','voicemail','wrong_number','no_interest','interested','qualified','callback','other') then
    raise exception 'invalid manual call outcome';
  end if;
  if p_outcome='callback' and p_callback_at is null then
    raise exception 'callback_at is required for callback outcome';
  end if;

  select * into v_task from public.manual_call_queue
   where id=p_task and owner_id=p_owner
   for update;
  if v_task.id is null then
    raise exception 'manual call task not found';
  end if;

  v_status := case when p_outcome='callback' then 'callback' else 'completed' end;
  update public.manual_call_queue
     set status=v_status,
         outcome=p_outcome,
         notes=coalesce(p_notes,''),
         called_at=v_now,
         callback_at=case when p_outcome='callback' then p_callback_at else null end,
         completed_at=case when p_outcome='callback' then null else v_now end,
         attempt_count=attempt_count+1,
         updated_at=v_now
   where id=p_task and owner_id=p_owner
   returning * into v_task;

  insert into public.manual_call_events(owner_id,task_id,outcome,notes,called_at)
  values(p_owner,p_task,p_outcome,coalesce(p_notes,''),v_now);

  return to_jsonb(v_task);
end $$;
revoke all on function public.complete_manual_call(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.complete_manual_call(uuid,uuid,text,text,timestamptz) to service_role;

alter table public.manual_call_settings enable row level security;
alter table public.manual_call_queue enable row level security;
alter table public.manual_call_events enable row level security;

do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='manual_call_settings' and policyname='manual_call_settings_admin') then
    create policy manual_call_settings_admin on public.manual_call_settings for all to authenticated using(public.is_admin() and owner_id=auth.uid()) with check(public.is_admin() and owner_id=auth.uid());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='manual_call_queue' and policyname='manual_call_queue_admin') then
    create policy manual_call_queue_admin on public.manual_call_queue for all to authenticated using(public.is_admin() and owner_id=auth.uid()) with check(public.is_admin() and owner_id=auth.uid());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='manual_call_events' and policyname='manual_call_events_admin') then
    create policy manual_call_events_admin on public.manual_call_events for all to authenticated using(public.is_admin() and owner_id=auth.uid()) with check(public.is_admin() and owner_id=auth.uid());
  end if;
end $$;

commit;
