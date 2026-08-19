begin;

create or replace function public.reserve_outreach_quota(
  p_owner uuid,
  p_daily_limit integer,
  p_hourly_limit integer
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count integer;
  v_hour integer;
begin
  insert into public.daily_usage(owner_id, usage_date) values (p_owner, v_day)
    on conflict (owner_id, usage_date) do nothing;
  select outreach_count into v_count from public.daily_usage
    where owner_id = p_owner and usage_date = v_day for update;
  if coalesce(v_count, 0) >= greatest(0, p_daily_limit) then
    return jsonb_build_object('allowed', false, 'reason', 'Limite diário geral atingido.',
      'retryAt', ((v_day + 1)::timestamp at time zone 'America/Sao_Paulo'));
  end if;
  select count(*) into v_hour from public.messages
    where owner_id = p_owner and direction = 'outbound'
      and sent_at >= date_trunc('hour', now())
      and (metadata->>'newLeadReservation') = 'true';
  if coalesce(v_hour, 0) >= greatest(0, p_hourly_limit) then
    return jsonb_build_object('allowed', false, 'reason', 'Limite por hora atingido.',
      'retryAt', date_trunc('hour', now()) + interval '1 hour');
  end if;
  update public.daily_usage
    set outreach_count = coalesce(outreach_count, 0) + 1, updated_at = now()
    where owner_id = p_owner and usage_date = v_day;
  return jsonb_build_object('allowed', true, 'reason', null, 'retryAt', now());
end $$;

revoke all on function public.reserve_outreach_quota(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_outreach_quota(uuid,integer,integer) to service_role;
commit;
