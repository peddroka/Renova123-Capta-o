begin;

create or replace function public.claim_queue_items(p_queue text,p_limit integer,p_worker_id text)
returns table(queue_name text,id uuid,owner_id uuid,payload jsonb,attempts integer,max_attempts integer,deduplication_key text)
language plpgsql security definer set search_path=public as $$
begin
  if p_queue not in ('outreach_queue','ai_response_queue','follow_up_queue') then raise exception 'invalid queue'; end if;
  return query execute format($query$
    with claimed as (
      select q.id from public.%I q
      where q.status in ('pending','scheduled','retry') and q.available_at<=now() and q.attempts<q.max_attempts
      order by q.priority,q.available_at,q.created_at
      for update skip locked limit $1
    )
    update public.%I q set status='processing',locked_at=now(),locked_by=left($2,120),attempts=q.attempts+1,updated_at=now()
    from claimed where q.id=claimed.id
    returning %L::text,q.id,q.owner_id,q.payload,q.attempts,q.max_attempts,q.deduplication_key
  $query$,p_queue,p_queue,p_queue) using least(greatest(p_limit,1),100),p_worker_id;
end $$;
revoke all on function public.claim_queue_items(text,integer,text) from public,anon,authenticated;
grant execute on function public.claim_queue_items(text,integer,text) to service_role;

create or replace function public.acquire_worker_lock(p_owner uuid,p_instance_id text,p_worker_type text,p_ttl_seconds integer default 30)
returns boolean language plpgsql security definer set search_path=public as $$
declare acquired uuid;
begin
  insert into public.worker_heartbeats(owner_id,instance_id,worker_type,hostname,process_id,status,last_heartbeat_at,lock_expires_at)
  values(p_owner,left(p_instance_id,160),left(p_worker_type,100),coalesce(current_setting('application_name',true),''),pg_backend_pid(),'running',now(),now()+make_interval(secs=>least(greatest(p_ttl_seconds,10),300)))
  on conflict(owner_id,worker_type) do update set
    instance_id=excluded.instance_id,status='running',last_heartbeat_at=now(),lock_expires_at=excluded.lock_expires_at,updated_at=now()
  where public.worker_heartbeats.lock_expires_at<now() or public.worker_heartbeats.instance_id=excluded.instance_id
  returning id into acquired;
  return acquired is not null;
end $$;

create or replace function public.heartbeat_worker(p_instance_id text,p_ttl_seconds integer default 30)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.worker_heartbeats set status='running',last_heartbeat_at=now(),lock_expires_at=now()+make_interval(secs=>least(greatest(p_ttl_seconds,10),300)),updated_at=now()
  where instance_id=p_instance_id and lock_expires_at>=now()-interval '5 seconds';
  return found;
end $$;

create or replace function public.release_worker_lock(p_instance_id text)
returns void language sql security definer set search_path=public as $$
  update public.worker_heartbeats set status='stopped',last_heartbeat_at=now(),lock_expires_at=now(),updated_at=now() where instance_id=p_instance_id;
$$;

revoke all on function public.acquire_worker_lock(uuid,text,text,integer),public.heartbeat_worker(text,integer),public.release_worker_lock(text) from public,anon,authenticated;
grant execute on function public.acquire_worker_lock(uuid,text,text,integer),public.heartbeat_worker(text,integer),public.release_worker_lock(text) to service_role;

create or replace function public.recover_stale_queue_items(p_stale_after interval default interval '5 minutes')
returns integer language plpgsql security definer set search_path=public as $$
declare queue_table text; affected integer; total_affected integer:=0;
begin
  foreach queue_table in array array['outreach_queue','ai_response_queue','follow_up_queue'] loop
    execute format('update public.%I set status=case when attempts>=max_attempts then ''dead_letter''::public.queue_status else ''retry''::public.queue_status end,available_at=case when attempts>=max_attempts then available_at else now()+interval ''1 minute'' end,locked_at=null,locked_by=null,last_error=coalesce(last_error,''worker lock expired''),updated_at=now() where status=''processing'' and locked_at<now()-$1',queue_table) using p_stale_after;
    get diagnostics affected=row_count; total_affected:=total_affected+affected;
  end loop;
  return total_affected;
end $$;
revoke all on function public.recover_stale_queue_items(interval) from public,anon,authenticated;
grant execute on function public.recover_stale_queue_items(interval) to service_role;

create or replace function public.sync_legacy_settings_to_app_settings() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.app_settings(owner_id,section,values,created_at,updated_at)
  values(new.owner_id,new.section,new.values,new.created_at,new.updated_at)
  on conflict(owner_id,section) do update set values=excluded.values,updated_at=now();
  return new;
end $$;
create trigger system_settings_sync after insert or update on public.system_settings for each row execute function public.sync_legacy_settings_to_app_settings();

insert into public.app_settings(owner_id,section,values,created_at,updated_at)
select owner_id,section,values,created_at,updated_at from public.system_settings
on conflict(owner_id,section) do update set values=excluded.values,updated_at=excluded.updated_at;

commit;
