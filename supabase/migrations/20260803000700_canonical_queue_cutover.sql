begin;

alter table public.audit_logs
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='audit_logs_updated_at') then
    create trigger audit_logs_updated_at before update on public.audit_logs
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- Mantém a assinatura já consumida pela API, mas grava a importação nas
-- entidades canônicas em vez da fila de compatibilidade.
create or replace function public.import_lead_batch(p_owner uuid, batch_input jsonb, normalized_phones text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_batch uuid; v_phone text; v_lead uuid; v_imported integer:=0; v_skipped integer:=0;
  v_template record; v_start timestamptz; v_available timestamptz; v_min integer; v_max integer;
  v_window_start time; v_window_end time; v_timezone text; v_daily_limit integer;
  v_day_offset integer; v_slot integer; v_day date;
  v_index integer:=0; v_priority smallint; v_text text;
begin
  if p_owner is null or not exists(select 1 from public.profiles where id=p_owner and role='admin') then raise exception 'not authorized'; end if;
  if coalesce((batch_input->>'authorized')::boolean,false) is not true then raise exception 'authorization confirmation required'; end if;
  if cardinality(normalized_phones)>50000 then raise exception 'too many phones'; end if;

  v_priority:=coalesce((batch_input->>'priority')::smallint,5);
  insert into public.lead_batches(owner_id,name,source,context,notes,initial_strategy,authorized,priority,start_date,daily_limit,status)
  values(p_owner,left(trim(batch_input->>'name'),120),left(trim(batch_input->>'source'),200),coalesce(batch_input->>'context',''),coalesce(batch_input->>'notes',''),coalesce(batch_input->>'initialStrategy',''),true,v_priority,coalesce((batch_input->>'startDate')::date,current_date),nullif(batch_input->>'dailyLimit','')::integer,'scheduled')
  returning id into v_batch;

  select (values->>'minIntervalSeconds')::integer,(values->>'maxIntervalSeconds')::integer,
    (values->>'startTime')::time,(values->>'endTime')::time,coalesce(values->>'timezone','America/Maceio'),
    coalesce((values->>'dailyLimit')::integer,100)
    into v_min,v_max,v_window_start,v_window_end,v_timezone,v_daily_limit
  from public.app_settings where owner_id=p_owner and section='outreach';
  if v_min is null or v_max is null then
    select (values->>'minIntervalSeconds')::integer,(values->>'maxIntervalSeconds')::integer,
      (values->>'startTime')::time,(values->>'endTime')::time,coalesce(values->>'timezone','America/Maceio'),
      coalesce((values->>'dailyLimit')::integer,100)
      into v_min,v_max,v_window_start,v_window_end,v_timezone,v_daily_limit
    from public.system_settings where owner_id=p_owner and section='outreach';
  end if;
  v_min:=coalesce(v_min,5); v_max:=greatest(v_min,coalesce(v_max,5));
  v_window_start:=coalesce(v_window_start,'08:00'); v_window_end:=coalesce(v_window_end,'22:00');
  v_timezone:=coalesce(v_timezone,'America/Maceio'); v_daily_limit:=greatest(1,coalesce(v_daily_limit,100));
  v_start:=greatest((coalesce((batch_input->>'startDate')::date,current_date))::timestamptz,now());

  foreach v_phone in array normalized_phones loop
    if v_phone !~ '^55[0-9]{10,11}$'
      or exists(select 1 from public.suppression_list where phone=v_phone and active)
      or exists(select 1 from public.leads where owner_id=p_owner and phone=v_phone)
    then v_skipped:=v_skipped+1; continue; end if;

    select id,content into v_template from public.message_templates
    where owner_id=p_owner and kind='initial' and active
    order by use_count,last_used_at nulls first,created_at limit 1;
    if v_template.id is null then raise exception 'at least one active initial message is required'; end if;

    insert into public.leads(owner_id,batch_id,phone,source,stage)
    values(p_owner,v_batch,v_phone,left(batch_input->>'source',200),'queued') returning id into v_lead;
    v_index:=v_index+1;
    v_day_offset:=floor((v_index-1)/v_daily_limit); v_slot:=mod(v_index-1,v_daily_limit);
    v_day:=(coalesce((batch_input->>'startDate')::date,current_date)+v_day_offset);
    v_available:=((v_day+v_window_start)::timestamp at time zone v_timezone);
    if v_available<now() and v_day=current_date then v_available:=now(); end if;
    v_available:=v_available + ((v_window_end-v_window_start) * (v_slot::numeric/greatest(1,v_daily_limit-1)));
    v_text:=replace(replace(replace(replace(replace(v_template.content,'{{nome}}',''),'{{empresa}}','Renova 123'),'{{produto}}','Renova 123'),'{{agente}}','Francisco'),'{{origem}}',coalesce(batch_input->>'source',''));

    insert into public.lead_batch_members(owner_id,batch_id,lead_id,position,status)
    values(p_owner,v_batch,v_lead,v_index,'scheduled');
    insert into public.outreach_queue(owner_id,lead_id,batch_id,template_id,status,priority,available_at,deduplication_key,payload)
    values(p_owner,v_lead,v_batch,v_template.id,case when v_available<=now() then 'pending'::public.queue_status else 'scheduled'::public.queue_status end,
      greatest(0,100-v_priority*10),v_available,'outreach:'||v_lead,
      jsonb_build_object('type','outreach','leadId',v_lead,'batchId',v_batch,'phone',v_phone,'text',v_text));
    update public.message_templates set use_count=use_count+1,last_used_at=now() where id=v_template.id;
    v_imported:=v_imported+1;
  end loop;

  update public.lead_batches set total_count=v_imported,status=case when start_date<=current_date then 'active' else 'scheduled' end where id=v_batch;
  insert into public.audit_logs(owner_id,actor_id,action,entity_type,entity_id,details)
  values(p_owner,p_owner,'batch.imported','lead_batch',v_batch::text,jsonb_build_object('imported',v_imported,'skipped',v_skipped,'queue','outreach_queue'));
  return jsonb_build_object('batch_id',v_batch,'imported',v_imported,'skipped',v_skipped);
end $$;
revoke all on function public.import_lead_batch(uuid,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.import_lead_batch(uuid,jsonb,text[]) to service_role;

create or replace function public.get_dashboard_stats(p_owner uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'totalLeads',count(*),
    'contactedToday',count(*) filter(where approached_at>=date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
    'activeConversations',count(*) filter(where stage in ('engaged','replied','qualifying','interested')),
    'interested',count(*) filter(where stage='interested'),
    'scheduledDemos',count(*) filter(where stage='demo_scheduled'),
    'handoffs',count(*) filter(where stage in ('handoff','human_handoff')),
    'optOuts',count(*) filter(where stage='opted_out'),
    'queuePending',
      (select count(*) from public.outreach_queue where owner_id=p_owner and status in ('pending','scheduled','retry'))+
      (select count(*) from public.ai_response_queue where owner_id=p_owner and status in ('pending','scheduled','retry'))+
      (select count(*) from public.follow_up_queue where owner_id=p_owner and status in ('pending','scheduled','retry'))+
      (select count(*) from public.jobs where owner_id=p_owner and status='pending'),
    'dailyLimit',coalesce((select (values->>'dailyLimit')::integer from public.app_settings where owner_id=p_owner and section='outreach'),40),
    'simulationMode',coalesce((select (values->>'simulationMode')::boolean from public.app_settings where owner_id=p_owner and section='general'),true)
  ) from public.leads where owner_id=p_owner;
$$;
revoke all on function public.get_dashboard_stats(uuid) from public,anon,authenticated;
grant execute on function public.get_dashboard_stats(uuid) to service_role;

commit;
