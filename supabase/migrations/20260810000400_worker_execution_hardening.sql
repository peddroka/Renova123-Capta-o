begin;

-- Legacy jobs must be claimed within the same owner scope as canonical queues.
drop function if exists public.claim_jobs(integer,text);
drop function if exists public.claim_jobs(uuid,integer,text);
create function public.claim_jobs(p_owner uuid,p_limit integer,p_worker_id text)
returns table(id uuid,type text,payload jsonb,attempts integer,max_attempts integer)
language plpgsql security definer set search_path=public as $$
begin
  return query with claimed as (
    select j.id from public.jobs j
    where j.owner_id=p_owner and j.status='pending' and j.available_at<=now() and j.attempts<j.max_attempts
    order by case j.type when 'opt_out' then 0 when 'inbound_reply' then 1 else 2 end,j.available_at,j.created_at
    for update skip locked limit least(greatest(p_limit,1),50)
  ), updated as (
    update public.jobs j set status='processing',locked_at=now(),locked_by=left(p_worker_id,160),attempts=j.attempts+1,updated_at=now()
    from claimed where j.id=claimed.id returning j.*
  ) select updated.id,updated.type,updated.payload,updated.attempts,updated.max_attempts from updated;
end $$;
revoke all on function public.claim_jobs(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.claim_jobs(uuid,integer,text) to service_role;

-- A heartbeat after expiry is not valid. The worker must stop and release work.
create or replace function public.heartbeat_worker(p_instance_id text,p_ttl_seconds integer default 30)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.worker_heartbeats set status='running',last_heartbeat_at=now(),lock_expires_at=now()+make_interval(secs=>least(greatest(p_ttl_seconds,10),300)),updated_at=now()
  where instance_id=p_instance_id and status='running' and lock_expires_at>=now();
  return found;
end $$;

-- Recover both canonical queues and the legacy jobs table after a crash.
create or replace function public.recover_stale_queue_items(p_stale_after interval default interval '5 minutes')
returns integer language plpgsql security definer set search_path=public as $$
declare queue_table text; affected integer; total_affected integer:=0;
begin
  foreach queue_table in array array['outreach_queue','ai_response_queue','follow_up_queue','jobs'] loop
    if queue_table='jobs' then
      execute 'update public.jobs set status=case when attempts>=max_attempts then ''dead''::public.job_status else ''pending''::public.job_status end,available_at=case when attempts>=max_attempts then available_at else now()+interval ''1 minute'' end,locked_at=null,locked_by=null,last_error=coalesce(last_error,''worker lock expired''),updated_at=now() where status=''processing'' and locked_at<now()-$1' using p_stale_after;
    else
      execute format('update public.%I set status=case when attempts>=max_attempts then ''dead_letter''::public.queue_status else ''retry''::public.queue_status end,available_at=case when attempts>=max_attempts then available_at else now()+interval ''1 minute'' end,locked_at=null,locked_by=null,last_error=coalesce(last_error,''worker lock expired''),updated_at=now() where status=''processing'' and locked_at<now()-$1',queue_table) using p_stale_after;
    end if;
    get diagnostics affected=row_count; total_affected:=total_affected+affected;
  end loop;
  return total_affected;
end $$;

commit;
