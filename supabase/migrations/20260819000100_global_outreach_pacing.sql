begin;

create or replace function public.reserve_outreach_pacing(
  p_owner uuid,
  p_min_interval_seconds integer default 45,
  p_max_interval_seconds integer default 90
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_next timestamptz;
  v_interval integer;
begin
  insert into public.daily_usage(owner_id, usage_date) values (p_owner, v_day)
    on conflict (owner_id, usage_date) do nothing;
  select next_outreach_at into v_next from public.daily_usage
    where owner_id = p_owner and usage_date = v_day for update;
  if v_next is not null and v_next > now() then
    return jsonb_build_object('allowed', false, 'retryAt', v_next,
      'intervalSeconds', extract(epoch from (v_next - now()))::integer);
  end if;
  v_interval := greatest(1, p_min_interval_seconds) +
    floor(random() * greatest(0, p_max_interval_seconds - p_min_interval_seconds + 1))::integer;
  v_next := now() + make_interval(secs => v_interval);
  update public.daily_usage set next_outreach_at = v_next, updated_at = now()
    where owner_id = p_owner and usage_date = v_day;
  return jsonb_build_object('allowed', true, 'retryAt', v_next, 'intervalSeconds', v_interval);
end $$;

revoke all on function public.reserve_outreach_pacing(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_outreach_pacing(uuid,integer,integer) to service_role;
commit;
