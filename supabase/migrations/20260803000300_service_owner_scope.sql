begin;

-- A API e o worker usam a service role somente no servidor. Como auth.uid() é
-- nulo nesse contexto, toda função operacional recebe explicitamente o único
-- administrador e continua isolando cada consulta por owner_id.
drop function if exists public.get_dashboard_stats();
create function public.get_dashboard_stats(p_owner uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'totalLeads', count(*),
    'contactedToday', count(*) filter (where approached_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
    'activeConversations', count(*) filter (where stage in ('engaged','interested')),
    'interested', count(*) filter (where stage='interested'),
    'scheduledDemos', count(*) filter (where stage='demo_scheduled'),
    'handoffs', count(*) filter (where stage='human_handoff'),
    'optOuts', count(*) filter (where stage='opted_out'),
    'queuePending', (select count(*) from public.jobs where owner_id=p_owner and status='pending'),
    'dailyLimit', coalesce((select (values->>'dailyLimit')::integer from public.system_settings where owner_id=p_owner and section='outreach'),40),
    'simulationMode', coalesce((select (values->>'simulationMode')::boolean from public.system_settings where owner_id=p_owner and section='general'),true)
  ) from public.leads where owner_id=p_owner;
$$;
revoke all on function public.get_dashboard_stats(uuid) from public, anon, authenticated;
grant execute on function public.get_dashboard_stats(uuid) to service_role;

drop function if exists public.import_lead_batch(jsonb,text[]);
create function public.import_lead_batch(p_owner uuid, batch_input jsonb, normalized_phones text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_batch uuid; v_phone text; v_lead uuid; v_imported integer:=0; v_skipped integer:=0;
  v_opening record; v_start timestamptz; v_min integer:=45; v_max integer:=180; v_index integer:=0;
begin
  if p_owner is null or not exists(select 1 from public.profiles where id=p_owner and role='admin') then raise exception 'not authorized'; end if;
  if coalesce((batch_input->>'authorized')::boolean,false) is not true then raise exception 'authorization confirmation required'; end if;
  if cardinality(normalized_phones)>50000 then raise exception 'too many phones'; end if;
  insert into public.lead_batches(owner_id,name,source,context,notes,initial_strategy,authorized,priority,start_date,daily_limit,status)
  values(p_owner,left(trim(batch_input->>'name'),120),left(trim(batch_input->>'source'),200),coalesce(batch_input->>'context',''),coalesce(batch_input->>'notes',''),coalesce(batch_input->>'initialStrategy',''),true,coalesce((batch_input->>'priority')::smallint,5),coalesce((batch_input->>'startDate')::date,current_date),nullif(batch_input->>'dailyLimit','')::integer,'scheduled') returning id into v_batch;
  select coalesce((values->>'minIntervalSeconds')::integer,45),coalesce((values->>'maxIntervalSeconds')::integer,180) into v_min,v_max from public.system_settings where owner_id=p_owner and section='outreach';
  v_start:=greatest((coalesce((batch_input->>'startDate')::date,current_date))::timestamptz,now());
  foreach v_phone in array normalized_phones loop
    if v_phone !~ '^55[0-9]{10,11}$'
      or exists(select 1 from public.suppression_list where phone=v_phone and active)
      or exists(select 1 from public.leads where owner_id=p_owner and phone=v_phone)
    then v_skipped:=v_skipped+1; continue; end if;
    insert into public.leads(owner_id,batch_id,phone,source,stage) values(p_owner,v_batch,v_phone,left(batch_input->>'source',200),'queued') returning id into v_lead;
    select id,content into v_opening from public.initial_messages where owner_id=p_owner and active order by use_count,last_used_at nulls first,random() limit 1;
    if v_opening.id is null then raise exception 'at least one active initial message is required'; end if;
    v_index:=v_index+1;
    insert into public.jobs(owner_id,type,payload,available_at,idempotency_key)
    values(
      p_owner,
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
  insert into public.audit_logs(owner_id,actor_id,action,entity_type,entity_id,details) values(p_owner,p_owner,'batch.imported','lead_batch',v_batch::text,jsonb_build_object('imported',v_imported,'skipped',v_skipped));
  return jsonb_build_object('batch_id',v_batch,'imported',v_imported,'skipped',v_skipped);
end $$;
revoke all on function public.import_lead_batch(uuid,jsonb,text[]) from public, anon, authenticated;
grant execute on function public.import_lead_batch(uuid,jsonb,text[]) to service_role;

create function public.check_outreach_capacity(p_owner uuid,p_lead uuid,p_daily_limit integer,p_hourly_limit integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_today integer; v_hour integer; v_batch_today integer; v_batch_limit integer; v_batch uuid;
  v_retry timestamptz:=date_trunc('hour',now())+interval '1 hour 1 minute';
begin
  select batch_id into v_batch from public.leads where owner_id=p_owner and id=p_lead;
  select count(*) into v_today from public.jobs where owner_id=p_owner and type='outreach' and status='completed' and completed_at>=date_trunc('day',now());
  select count(*) into v_hour from public.jobs where owner_id=p_owner and type='outreach' and status='completed' and completed_at>=date_trunc('hour',now());
  if v_batch is not null then
    select daily_limit into v_batch_limit from public.lead_batches where owner_id=p_owner and id=v_batch;
    select count(*) into v_batch_today from public.jobs j join public.leads l on l.id=(j.payload->>'leadId')::uuid
      where j.owner_id=p_owner and l.batch_id=v_batch and j.type='outreach' and j.status='completed' and j.completed_at>=date_trunc('day',now());
  else v_batch_today:=0; end if;
  if v_today>=p_daily_limit then return jsonb_build_object('allowed',false,'reason','Limite diário geral atingido.','retryAt',(date_trunc('day',now())+interval '1 day 9 hours')::text); end if;
  if v_hour>=p_hourly_limit then return jsonb_build_object('allowed',false,'reason','Limite por hora atingido.','retryAt',v_retry::text); end if;
  if v_batch_limit is not null and v_batch_today>=v_batch_limit then return jsonb_build_object('allowed',false,'reason','Limite diário do lote atingido.','retryAt',(date_trunc('day',now())+interval '1 day 9 hours')::text); end if;
  return jsonb_build_object('allowed',true,'reason',null,'retryAt',v_retry::text);
end $$;
revoke all on function public.check_outreach_capacity(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.check_outreach_capacity(uuid,uuid,integer,integer) to service_role;

create function public.defer_job(p_job uuid,p_retry_at timestamptz,p_reason text)
returns void language sql security definer set search_path=public as $$
  update public.jobs set status='pending',available_at=p_retry_at,locked_at=null,locked_by=null,attempts=greatest(0,attempts-1),last_error=p_reason,updated_at=now() where id=p_job;
$$;
revoke all on function public.defer_job(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.defer_job(uuid,timestamptz,text) to service_role;

create function public.enqueue_inbound_debounced(p_owner uuid,p_phone text,p_text text,p_message_id text,p_available_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_job uuid;
begin
  select id into v_job from public.jobs where owner_id=p_owner and type='inbound_reply' and status='pending' and payload->>'phone'=p_phone order by created_at desc for update skip locked limit 1;
  if v_job is null then
    insert into public.jobs(owner_id,type,payload,available_at,idempotency_key) values(p_owner,'inbound_reply',jsonb_build_object('phone',p_phone,'text',left(p_text,8000),'messageId',p_message_id),p_available_at,'reply:'||p_message_id) returning id into v_job;
  else
    update public.jobs set payload=jsonb_set(jsonb_set(payload,'{text}',to_jsonb(left(concat_ws(E'\n',payload->>'text',p_text),8000))),'{messageId}',to_jsonb(p_message_id)),available_at=p_available_at,updated_at=now() where id=v_job;
  end if;
  return v_job;
end $$;
revoke all on function public.enqueue_inbound_debounced(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_inbound_debounced(uuid,text,text,text,timestamptz) to service_role;

create function public.get_available_demo_slots(p_owner uuid,p_from timestamptz default now(),p_limit integer default 8)
returns table(starts_at timestamptz,ends_at timestamptz) language sql stable security definer set search_path=public as $$
with days as (select generate_series((p_from at time zone 'America/Sao_Paulo')::date,(p_from at time zone 'America/Sao_Paulo')::date+30,interval '1 day')::date as generated_date),
rules as (select r.*,d.generated_date from public.availability_rules r join days d on extract(dow from d.generated_date)=r.weekday where r.owner_id=p_owner and r.active),
slots as (select gs as start_at,gs+make_interval(mins=>r.duration_minutes) as end_at,r.min_notice_hours from rules r cross join lateral generate_series((r.generated_date+r.start_time) at time zone 'America/Sao_Paulo',((r.generated_date+r.end_time) at time zone 'America/Sao_Paulo')-make_interval(mins=>r.duration_minutes),make_interval(mins=>r.duration_minutes+r.buffer_minutes)) gs)
select s.start_at,s.end_at from slots s where s.start_at>=greatest(p_from,now()+make_interval(hours=>s.min_notice_hours)) and not exists(select 1 from public.appointments a where a.owner_id=p_owner and a.status in ('pending','scheduled') and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(s.start_at,s.end_at,'[)')) and not exists(select 1 from public.blocked_slots b where b.owner_id=p_owner and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(s.start_at,s.end_at,'[)')) order by s.start_at limit least(greatest(p_limit,1),50);
$$;
revoke all on function public.get_available_demo_slots(uuid,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.get_available_demo_slots(uuid,timestamptz,integer) to service_role;

commit;
