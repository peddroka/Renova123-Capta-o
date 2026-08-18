begin;

-- Francisco production repair. Independent from the historical THE WOLF migrations.
create or replace function public.recover_stale_queue_items(p_stale_after interval default interval '5 minutes')
returns integer language plpgsql security definer set search_path=public as $$
declare
  queue_table text;
  affected integer;
  total_affected integer := 0;
begin
  foreach queue_table in array array['outreach_queue','ai_response_queue','follow_up_queue'] loop
    execute format(
      'update public.%I
       set status=case when attempts>=max_attempts then ''dead_letter''::public.queue_status else ''retry''::public.queue_status end,
           available_at=case when attempts>=max_attempts then available_at else now()+interval ''1 minute'' end,
           locked_at=null,locked_by=null,last_error=coalesce(last_error,''worker lock expired''),updated_at=now()
       where status=''processing'' and locked_at<now()-$1',
      queue_table
    ) using p_stale_after;
    get diagnostics affected = row_count;
    total_affected := total_affected + affected;
  end loop;
  return total_affected;
end $$;
revoke all on function public.recover_stale_queue_items(interval) from public,anon,authenticated;
grant execute on function public.recover_stale_queue_items(interval) to service_role;

-- Apply only to owners whose Francisco profile is present; do not alter Wolf data.
update public.app_settings outreach
set values = outreach.values || '{"startTime":"08:00","endTime":"23:00","timezone":"America/Sao_Paulo","dailyLimit":50,"dailyProactiveLimit":50}'::jsonb,
    updated_at = now()
where outreach.section='outreach'
  and exists (
    select 1 from public.app_settings general
    where general.owner_id=outreach.owner_id and general.section='general'
      and coalesce(general.values->>'agentName','')='Francisco'
  );

update public.system_settings outreach
set values = outreach.values || '{"startTime":"08:00","endTime":"23:00","timezone":"America/Sao_Paulo","dailyLimit":50,"dailyProactiveLimit":50}'::jsonb,
    updated_at = now()
where outreach.section='outreach'
  and exists (
    select 1 from public.system_settings general
    where general.owner_id=outreach.owner_id and general.section='general'
      and coalesce(general.values->>'agentName','')='Francisco'
  );

commit;
