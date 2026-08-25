begin;

alter table public.daily_usage add column if not exists last_proactive_send_at timestamptz;
alter table public.daily_usage add column if not exists proactive_interval_minutes integer;

create or replace function public.reserve_outreach_pacing_minutes(
  p_owner uuid,
  p_min_interval_minutes integer default 12,
  p_max_interval_minutes integer default 24
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_next timestamptz;
  v_last timestamptz;
  v_interval integer;
begin
  if p_min_interval_minutes < 1 or p_max_interval_minutes < p_min_interval_minutes then
    raise exception 'invalid proactive pacing interval';
  end if;
  insert into public.daily_usage(owner_id, usage_date) values (p_owner, v_day)
    on conflict (owner_id, usage_date) do nothing;
  select next_outreach_at, last_proactive_send_at
    into v_next, v_last
    from public.daily_usage
   where owner_id = p_owner and usage_date = v_day
   for update;
  if v_next is not null and v_next > now() then
    return jsonb_build_object(
      'allowed', false,
      'retryAt', v_next,
      'intervalMinutes', null,
      'lastProactiveSendAt', v_last
    );
  end if;
  v_interval := p_min_interval_minutes + floor(random() * (p_max_interval_minutes - p_min_interval_minutes + 1))::integer;
  v_next := now() + make_interval(mins => v_interval);
  update public.daily_usage
     set next_outreach_at = v_next,
         proactive_interval_minutes = v_interval,
         updated_at = now()
   where owner_id = p_owner and usage_date = v_day;
  return jsonb_build_object(
    'allowed', true,
    'retryAt', v_next,
    'intervalMinutes', v_interval,
    'lastProactiveSendAt', v_last
  );
end $$;

create or replace function public.mark_outreach_pacing_sent(
  p_owner uuid,
  p_sent_at timestamptz default now()
)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_day date := (p_sent_at at time zone 'America/Sao_Paulo')::date;
begin
  insert into public.daily_usage(owner_id, usage_date) values (p_owner, v_day)
    on conflict (owner_id, usage_date) do nothing;
  update public.daily_usage
     set last_proactive_send_at = p_sent_at,
         updated_at = now()
   where owner_id = p_owner and usage_date = v_day;
end $$;

revoke all on function public.reserve_outreach_pacing_minutes(uuid,integer,integer), public.mark_outreach_pacing_sent(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.reserve_outreach_pacing_minutes(uuid,integer,integer), public.mark_outreach_pacing_sent(uuid,timestamptz) to service_role;

update public.system_settings
   set values = values || '{"minIntervalMinutes":12,"maxIntervalMinutes":24}'::jsonb,
       updated_at = now()
 where section = 'outreach';

commit;
