begin;

create or replace function public.enqueue_inbound_debounced(p_owner uuid,p_phone text,p_text text,p_message_id text,p_available_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_job uuid;
begin
  select id into v_job
    from public.jobs
   where owner_id=p_owner and type='inbound_reply' and status='pending' and payload->>'phone'=p_phone
   order by created_at desc for update skip locked limit 1;
  if v_job is not null then
    update public.jobs
       set payload=jsonb_set(jsonb_set(payload,'{text}',to_jsonb(left(concat_ws(E'\n',payload->>'text',p_text),8000))),'{messageId}',to_jsonb(p_message_id)),available_at=p_available_at,updated_at=now()
     where id=v_job;
    return v_job;
  end if;

  select id into v_job
    from public.jobs
   where owner_id=p_owner and type='inbound_reply' and idempotency_key='reply:'||p_message_id
   for update skip locked limit 1;
  if v_job is not null then
    update public.jobs
       set status='pending',attempts=0,available_at=p_available_at,locked_at=null,locked_by=null,last_error=null,
           payload=jsonb_build_object('phone',p_phone,'text',left(p_text,8000),'messageId',p_message_id),updated_at=now()
     where id=v_job and status in ('dead','failed');
    return v_job;
  end if;

  insert into public.jobs(owner_id,type,payload,available_at,idempotency_key)
  values(p_owner,'inbound_reply',jsonb_build_object('phone',p_phone,'text',left(p_text,8000),'messageId',p_message_id),p_available_at,'reply:'||p_message_id)
  returning id into v_job;
  return v_job;
end $$;

revoke all on function public.enqueue_inbound_debounced(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_inbound_debounced(uuid,text,text,text,timestamptz) to service_role;

commit;
