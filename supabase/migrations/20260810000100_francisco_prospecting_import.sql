begin;

-- Import provenance is immutable metadata on the canonical lead. International
-- numbers are retained but are never put in the Brazilian outreach queue.
alter table public.leads drop constraint if exists leads_phone_check;
alter table public.leads add constraint leads_phone_check check (phone ~ '^[0-9]{7,15}$');
alter table public.suppression_list drop constraint if exists suppression_list_phone_check;
alter table public.suppression_list add constraint suppression_list_phone_check check (phone ~ '^[0-9]{7,15}$');

create or replace function public.import_lead_batch(p_owner uuid, batch_input jsonb, normalized_phones text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_batch uuid; v_phone text; v_lead uuid; v_imported integer:=0; v_skipped integer:=0; v_existing integer:=0; v_provenance integer:=0;
  v_template record; v_available timestamptz; v_min integer; v_max integer; v_window_start time; v_window_end time; v_timezone text; v_daily_limit integer;
  v_day_offset integer; v_slot integer; v_day date; v_index integer:=0; v_priority smallint; v_text text; v_source_group text; v_source_label text; v_original text;
  v_source_file text; v_campaign_start timestamptz;
begin
  if p_owner is null or not exists(select 1 from public.profiles where id=p_owner and role='admin') then raise exception 'not authorized'; end if;
  if coalesce((batch_input->>'authorized')::boolean,false) is not true then raise exception 'authorization confirmation required'; end if;
  if cardinality(normalized_phones)>50000 then raise exception 'too many phones'; end if;
  v_source_group:=coalesce(batch_input->>'sourceGroup', batch_input->>'source');
  v_source_label:=coalesce(batch_input->>'sourceLabel', batch_input->>'source');
  v_source_file:=coalesce(batch_input->>'sourceFile','');
  select id into v_batch from public.lead_batches where owner_id=p_owner and name=left(trim(batch_input->>'name'),120) limit 1;
  if v_batch is null then
    insert into public.lead_batches(owner_id,name,source,context,notes,initial_strategy,authorized,priority,start_date,daily_limit,status)
    values(p_owner,left(trim(batch_input->>'name'),120),left(trim(v_source_label),200),coalesce(batch_input->>'context',''),coalesce(batch_input->>'notes',''),coalesce(batch_input->>'initialStrategy',''),true,coalesce((batch_input->>'priority')::smallint,5),coalesce((batch_input->>'startDate')::date,current_date),nullif(batch_input->>'dailyLimit','')::integer,'scheduled') returning id into v_batch;
  end if;

  select (values->>'minIntervalSeconds')::integer,(values->>'maxIntervalSeconds')::integer,(values->>'startTime')::time,(values->>'endTime')::time,
    coalesce(values->>'timezone','America/Maceio'),greatest(1,coalesce((values->>'dailyLimit')::integer,100)),nullif(values->>'campaignStartAt','')::timestamptz
    into v_min,v_max,v_window_start,v_window_end,v_timezone,v_daily_limit,v_campaign_start
    from public.app_settings where owner_id=p_owner and section='outreach';
  v_min:=coalesce(v_min,5); v_max:=greatest(v_min,coalesce(v_max,5)); v_window_start:=coalesce(v_window_start,'08:00'); v_window_end:=coalesce(v_window_end,'22:00'); v_timezone:=coalesce(v_timezone,'America/Maceio'); v_daily_limit:=coalesce(v_daily_limit,100);
  v_campaign_start:=coalesce(v_campaign_start, ((coalesce((batch_input->>'startDate')::date,current_date)+v_window_start)::timestamp at time zone v_timezone)); v_priority:=coalesce((batch_input->>'priority')::smallint,5);

  foreach v_phone in array normalized_phones loop
    if v_phone !~ '^[0-9]{7,15}$' then v_skipped:=v_skipped+1; continue; end if;
    v_original:=coalesce((batch_input->'phoneRecords'->v_phone->>'originalPhone'),v_phone);
    select id into v_lead from public.leads where owner_id=p_owner and phone=v_phone;
    if v_lead is not null then
      update public.leads set metadata=jsonb_set(jsonb_set(metadata,'{sourceGroups}',case when coalesce(metadata->'sourceGroups','[]'::jsonb) @> to_jsonb(array[v_source_group]) then coalesce(metadata->'sourceGroups','[]'::jsonb) else coalesce(metadata->'sourceGroups','[]'::jsonb)||to_jsonb(v_source_group) end,true),'{imports}',case when coalesce(metadata->'imports','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('sourceGroup',v_source_group,'sourceFile',v_source_file)) then coalesce(metadata->'imports','[]'::jsonb) else coalesce(metadata->'imports','[]'::jsonb)||jsonb_build_object('sourceGroup',v_source_group,'sourceFile',v_source_file,'originalPhone',v_original,'importedAt',now()) end,true) where id=v_lead;
      insert into public.lead_batch_members(owner_id,batch_id,lead_id,position,status,skip_reason) select p_owner,v_batch,v_lead,null,'skipped','lead preexistente; sem novo opener' where not exists(select 1 from public.lead_batch_members where batch_id=v_batch and lead_id=v_lead);
      v_existing:=v_existing+1; v_provenance:=v_provenance+1; continue;
    end if;
    if exists(select 1 from public.suppression_list where phone=v_phone and active) then v_skipped:=v_skipped+1; continue; end if;
    insert into public.leads(owner_id,batch_id,phone,source,stage,metadata)
      values(p_owner,v_batch,v_phone,left(v_source_label,200),(case when left(v_phone,2)='55' then 'queued' else 'imported' end)::public.lead_stage,
        jsonb_build_object('sourceGroups',jsonb_build_array(v_source_group),'imports',jsonb_build_array(jsonb_build_object('sourceGroup',v_source_group,'sourceFile',v_source_file,'originalPhone',v_original,'importedAt',now())))) returning id into v_lead;
    insert into public.lead_batch_members(owner_id,batch_id,lead_id,position,status) values(p_owner,v_batch,v_lead,v_index+1,case when left(v_phone,2)='55' then 'scheduled' else 'skipped' end);
    v_imported:=v_imported+1;
    if left(v_phone,2)<>'55' then continue; end if;
    select id,content into v_template from public.message_templates where owner_id=p_owner and kind='initial' and active order by use_count,last_used_at nulls first,created_at limit 1;
    if v_template.id is null then raise exception 'at least one active initial message is required'; end if;
    v_index:=v_index+1; v_day_offset:=floor((v_index-1)/v_daily_limit); v_slot:=mod(v_index-1,v_daily_limit); v_day:=(coalesce((batch_input->>'startDate')::date,current_date)+v_day_offset);
    v_available:=greatest(v_campaign_start,((v_day+v_window_start)::timestamp at time zone v_timezone));
    v_available:=v_available+((v_window_end-v_window_start)*(v_slot::numeric/greatest(1,v_daily_limit-1)));
    v_text:=replace(replace(replace(replace(replace(v_template.content,'{{nome}}',''),'{{empresa}}','Renova 123'),'{{produto}}','Renova 123'),'{{agente}}','Francisco'),'{{origem}}',coalesce(v_source_label,''));
    insert into public.outreach_queue(owner_id,lead_id,batch_id,template_id,status,priority,available_at,deduplication_key,payload) values(p_owner,v_lead,v_batch,v_template.id,'scheduled',greatest(0,100-v_priority*10),v_available,'outreach:'||v_lead,jsonb_build_object('type','outreach','leadId',v_lead,'batchId',v_batch,'phone',v_phone,'text',v_text,'newLeadReservation',true));
    update public.message_templates set use_count=use_count+1,last_used_at=now() where id=v_template.id;
  end loop;
  update public.lead_batches set total_count=(select count(*) from public.lead_batch_members where batch_id=v_batch),status='scheduled' where id=v_batch;
  insert into public.audit_logs(owner_id,actor_id,action,entity_type,entity_id,details) values(p_owner,p_owner,'batch.imported','lead_batch',v_batch::text,jsonb_build_object('imported',v_imported,'skipped',v_skipped,'existing',v_existing,'provenanceUpdated',v_provenance,'sourceGroup',v_source_group,'sourceFile',v_source_file));
  return jsonb_build_object('batch_id',v_batch,'imported',v_imported,'skipped',v_skipped,'existing',v_existing,'provenanceUpdated',v_provenance);
end $$;

create or replace function public.check_outreach_capacity(p_owner uuid,p_lead uuid,p_daily_limit integer,p_hourly_limit integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_day date; v_hour_start timestamptz; v_count integer; v_hour integer; v_batch uuid; v_batch_limit integer; v_reserved boolean:=false; v_retry timestamptz;
begin
  select (now() at time zone coalesce((values->>'timezone'),'America/Maceio'))::date into v_day from public.app_settings where owner_id=p_owner and section='outreach';
  v_day:=coalesce(v_day,(now() at time zone 'America/Maceio')::date); v_hour_start:=date_trunc('hour',now());
  insert into public.daily_usage(owner_id,usage_date) values(p_owner,v_day) on conflict(owner_id,usage_date) do nothing;
  select outreach_count into v_count from public.daily_usage where owner_id=p_owner and usage_date=v_day for update;
  select count(*) into v_hour from public.messages where owner_id=p_owner and direction='outbound' and sent_at>=v_hour_start and (metadata->>'newLeadReservation')='true';
  select batch_id into v_batch from public.leads where owner_id=p_owner and id=p_lead;
  if v_batch is not null then select daily_limit into v_batch_limit from public.lead_batches where id=v_batch; end if;
  if v_count>=p_daily_limit then return jsonb_build_object('allowed',false,'reason','Limite diário geral atingido.','retryAt',((v_day+1)::text||' 08:00:00')::timestamp at time zone 'America/Maceio'); end if;
  if v_hour>=p_hourly_limit then return jsonb_build_object('allowed',false,'reason','Limite por hora atingido.','retryAt',v_hour_start+interval '1 hour'); end if;
  update public.daily_usage set outreach_count=outreach_count+1 where owner_id=p_owner and usage_date=v_day;
  return jsonb_build_object('allowed',true,'reason',null,'retryAt',(((v_day+1)::text||' 08:00:00')::timestamp at time zone 'America/Maceio'));
end $$;
revoke all on function public.check_outreach_capacity(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.check_outreach_capacity(uuid,uuid,integer,integer) to service_role;

commit;
