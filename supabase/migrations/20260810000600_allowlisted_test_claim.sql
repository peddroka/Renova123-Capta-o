begin;

create or replace function public.claim_queue_items_allowlisted(
  p_queue text,
  p_limit integer,
  p_worker_id text,
  p_phone_allowlist text[]
)
returns table(queue_name text,id uuid,owner_id uuid,payload jsonb,attempts integer,max_attempts integer,deduplication_key text)
language plpgsql security definer set search_path=public as $$
begin
  if p_queue not in ('outreach_queue','follow_up_queue') then raise exception 'invalid queue'; end if;
  return query execute format($query$
    with claimed as (
      select q.id from public.%I q
      where q.status in ('pending','scheduled','retry')
        and q.available_at<=now()
        and q.attempts<q.max_attempts
        and q.payload->>'phone'=any($3)
      order by q.priority,q.available_at,q.created_at
      for update skip locked limit $1
    )
    update public.%I q set status='processing',locked_at=now(),locked_by=left($2,120),attempts=q.attempts+1,updated_at=now()
    from claimed where q.id=claimed.id
    returning %L::text,q.id,q.owner_id,q.payload,q.attempts,q.max_attempts,q.deduplication_key
  $query$,p_queue,p_queue,p_queue) using least(greatest(p_limit,1),100),p_worker_id,p_phone_allowlist;
end $$;

revoke all on function public.claim_queue_items_allowlisted(text,integer,text,text[]) from public,anon,authenticated;
grant execute on function public.claim_queue_items_allowlisted(text,integer,text,text[]) to service_role;

commit;
