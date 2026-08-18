begin;

create or replace function public.get_dashboard_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'totalLeads', count(*),
    'contactedToday', count(*) filter (where approached_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
    'activeConversations', count(*) filter (where stage in ('engaged','interested')),
    'interested', count(*) filter (where stage='interested'),
    'scheduledDemos', count(*) filter (where stage='demo_scheduled'),
    'handoffs', count(*) filter (where stage='human_handoff'),
    'optOuts', count(*) filter (where stage='opted_out'),
    'queuePending', (select count(*) from public.jobs where owner_id=auth.uid() and status='pending'),
    'dailyLimit', coalesce((select (values->>'dailyLimit')::integer from public.system_settings where owner_id=auth.uid() and section='outreach'),40),
    'simulationMode', coalesce((select (values->>'simulationMode')::boolean from public.system_settings where owner_id=auth.uid() and section='general'),true)
  ) from public.leads where owner_id=auth.uid();
$$;
grant execute on function public.get_dashboard_stats() to authenticated, service_role;

create or replace function public.record_webhook_event(p_event_id text, p_event_type text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.webhook_events(event_id,event_type,payload) values(left(p_event_id,300),left(p_event_type,100),p_payload)
  on conflict(event_id) do nothing;
  return found;
end $$;
revoke all on function public.record_webhook_event(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_webhook_event(text,text,jsonb) to service_role;

create or replace function public.claim_jobs(p_limit integer, p_worker_id text)
returns table(id uuid,type text,payload jsonb,attempts integer)
language plpgsql security definer set search_path = public as $$
begin
  return query with claimed as (
    select j.id from public.jobs j where j.status='pending' and j.available_at<=now()
    order by case j.type when 'opt_out' then 0 when 'inbound_reply' then 1 else 2 end,j.available_at,j.created_at
    for update skip locked limit least(greatest(p_limit,1),50)
  ), updated as (
    update public.jobs j set status='processing',locked_at=now(),locked_by=left(p_worker_id,100),attempts=j.attempts+1,updated_at=now()
    from claimed where j.id=claimed.id returning j.*
  ) select updated.id,updated.type,updated.payload,updated.attempts from updated;
end $$;
revoke all on function public.claim_jobs(integer,text) from public, anon, authenticated;
grant execute on function public.claim_jobs(integer,text) to service_role;

create or replace function public.recover_stale_jobs() returns integer language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  update public.jobs set status=case when attempts>=max_attempts then 'dead'::public.job_status else 'pending'::public.job_status end,
    available_at=now()+interval '1 minute',locked_at=null,locked_by=null,last_error=coalesce(last_error,'Worker interrompido.'),updated_at=now()
  where status='processing' and locked_at<now()-interval '10 minutes';
  get diagnostics affected=row_count; return affected;
end $$;
revoke all on function public.recover_stale_jobs() from public,anon,authenticated;
grant execute on function public.recover_stale_jobs() to service_role;

create or replace function public.import_lead_batch(batch_input jsonb, normalized_phones text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_owner uuid:=auth.uid(); v_batch uuid; v_phone text; v_lead uuid; v_imported integer:=0; v_skipped integer:=0;
  v_opening record; v_start timestamptz; v_min integer:=45; v_max integer:=180; v_index integer:=0;
begin
  if v_owner is null or not public.is_admin() then raise exception 'not authorized'; end if;
  if coalesce((batch_input->>'authorized')::boolean,false) is not true then raise exception 'authorization confirmation required'; end if;
  if cardinality(normalized_phones)>50000 then raise exception 'too many phones'; end if;
  insert into public.lead_batches(owner_id,name,source,context,notes,initial_strategy,authorized,priority,start_date,daily_limit,status)
  values(v_owner,left(trim(batch_input->>'name'),120),left(trim(batch_input->>'source'),200),coalesce(batch_input->>'context',''),coalesce(batch_input->>'notes',''),coalesce(batch_input->>'initialStrategy',''),true,coalesce((batch_input->>'priority')::smallint,5),coalesce((batch_input->>'startDate')::date,current_date),nullif(batch_input->>'dailyLimit','')::integer,'scheduled') returning id into v_batch;
  select coalesce((values->>'minIntervalSeconds')::integer,45),coalesce((values->>'maxIntervalSeconds')::integer,180) into v_min,v_max from public.system_settings where owner_id=v_owner and section='outreach';
  v_start:=greatest((coalesce((batch_input->>'startDate')::date,current_date))::timestamptz,now());
  foreach v_phone in array normalized_phones loop
    if v_phone !~ '^55[0-9]{10,11}$' or exists(select 1 from public.suppression_list where phone=v_phone and active) or exists(select 1 from public.leads where owner_id=v_owner and phone=v_phone) then v_skipped:=v_skipped+1; continue; end if;
    insert into public.leads(owner_id,batch_id,phone,source,stage) values(v_owner,v_batch,v_phone,left(batch_input->>'source',200),'queued') returning id into v_lead;
    select id,content into v_opening from public.initial_messages where owner_id=v_owner and active order by use_count,last_used_at nulls first,random() limit 1;
    if v_opening.id is null then raise exception 'at least one active initial message is required'; end if;
    v_index:=v_index+1;
    insert into public.jobs(owner_id,type,payload,available_at,idempotency_key)
    values(
      v_owner,
      'outreach',
      jsonb_build_object(
        'leadId', v_lead,
        'phone', v_phone,
        'text', replace(replace(replace(replace(replace(v_opening.content, '{{nome}}', ''), '{{empresa}}', 'Renova 123'), '{{produto}}', 'Renova 123'), '{{agente}}', 'Francisco'), '{{origem}}', coalesce(batch_input->>'source', ''))
      ),
      v_start + make_interval(secs => v_index * (v_min + floor(random() * greatest(1, v_max - v_min + 1))::integer)),
      'outreach:' || v_lead
    );
    update public.initial_messages set use_count=use_count+1,last_used_at=now() where id=v_opening.id;
    v_imported:=v_imported+1;
  end loop;
  update public.lead_batches set total_count=v_imported,status=case when start_date<=current_date then 'active' else 'scheduled' end where id=v_batch;
  insert into public.audit_logs(owner_id,actor_id,action,entity_type,entity_id,details) values(v_owner,v_owner,'batch.imported','lead_batch',v_batch::text,jsonb_build_object('imported',v_imported,'skipped',v_skipped));
  return jsonb_build_object('batch_id',v_batch,'imported',v_imported,'skipped',v_skipped);
end $$;
revoke all on function public.import_lead_batch(jsonb,text[]) from public,anon;
grant execute on function public.import_lead_batch(jsonb,text[]) to authenticated;

create or replace function public.get_available_demo_slots(p_from timestamptz default now(),p_limit integer default 8)
returns table(starts_at timestamptz,ends_at timestamptz) language sql stable security definer set search_path=public as $$
with days as (select generate_series((p_from at time zone 'America/Sao_Paulo')::date,(p_from at time zone 'America/Sao_Paulo')::date+30,interval '1 day')::date as generated_date),
rules as (select r.*,d.generated_date from public.availability_rules r join days d on extract(dow from d.generated_date)=r.weekday where r.owner_id=coalesce(auth.uid(),r.owner_id) and r.active),
slots as (select gs as start_at,gs+make_interval(mins=>r.duration_minutes) as end_at from rules r cross join lateral generate_series((r.generated_date+r.start_time) at time zone 'America/Sao_Paulo',((r.generated_date+r.end_time) at time zone 'America/Sao_Paulo')-make_interval(mins=>r.duration_minutes),make_interval(mins=>r.duration_minutes+r.buffer_minutes)) gs)
select s.start_at,s.end_at from slots s where s.start_at>=p_from and not exists(select 1 from public.appointments a where a.status in ('pending','scheduled') and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(s.start_at,s.end_at,'[)')) and not exists(select 1 from public.blocked_slots b where tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(s.start_at,s.end_at,'[)')) order by s.start_at limit least(greatest(p_limit,1),50);
$$;
grant execute on function public.get_available_demo_slots(timestamptz,integer) to authenticated,service_role;

create or replace function public.prevent_overlapping_appointments() returns trigger language plpgsql set search_path=public as $$
begin if new.status in ('pending','scheduled') and exists(select 1 from public.appointments where owner_id=new.owner_id and id<>new.id and status in ('pending','scheduled') and tstzrange(starts_at,ends_at,'[)')&&tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'appointment slot is no longer available'; end if; return new; end $$;
create trigger appointments_no_overlap before insert or update on public.appointments for each row execute function public.prevent_overlapping_appointments();

commit;
