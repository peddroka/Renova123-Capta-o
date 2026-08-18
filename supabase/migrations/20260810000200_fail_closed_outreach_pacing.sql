begin;

alter table public.daily_usage add column if not exists next_outreach_at timestamptz;

create or replace function public.check_outreach_capacity(p_owner uuid,p_lead uuid,p_daily_limit integer,p_hourly_limit integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_settings jsonb; v_enabled boolean; v_timezone text; v_day date; v_now_local timestamp; v_start time; v_end time; v_start_local timestamp; v_end_local timestamp;
  v_campaign_start timestamptz; v_count integer; v_hour integer; v_next timestamptz; v_interval numeric; v_remaining integer; v_retry timestamptz;
begin
  select values into v_settings from public.app_settings where owner_id=p_owner and section='outreach';
  v_settings:=coalesce(v_settings,'{}'::jsonb); v_enabled:=coalesce((v_settings->>'enabled')::boolean,false); v_timezone:=coalesce(v_settings->>'timezone','America/Maceio');
  if not v_enabled then return jsonb_build_object('allowed',false,'reason','Outreach persistido desligado.','retryAt',now()+interval '5 minutes'); end if;
  v_now_local:=now() at time zone v_timezone; v_day:=v_now_local::date; v_start:=coalesce((v_settings->>'startTime')::time,'08:00'); v_end:=coalesce((v_settings->>'endTime')::time,'22:00');
  v_start_local:=(v_day+v_start)::timestamp; v_end_local:=(v_day+v_end)::timestamp; v_campaign_start:=nullif(v_settings->>'campaignStartAt','')::timestamptz;
  if v_campaign_start is not null and now()<v_campaign_start then return jsonb_build_object('allowed',false,'reason','Campanha ainda não iniciou.','retryAt',v_campaign_start); end if;
  if extract(dow from v_now_local)::integer <> all(coalesce((select array(select jsonb_array_elements_text(v_settings->'weekdays')::integer)),array[0,1,2,3,4,5,6])) or v_now_local<v_start_local or v_now_local>=v_end_local then return jsonb_build_object('allowed',false,'reason','Fora do horário configurado.','retryAt',(v_day+1+v_start)::timestamp at time zone v_timezone); end if;
  insert into public.daily_usage(owner_id,usage_date) values(p_owner,v_day) on conflict(owner_id,usage_date) do nothing;
  select outreach_count,next_outreach_at into v_count,v_next from public.daily_usage where owner_id=p_owner and usage_date=v_day for update;
  if v_count>=p_daily_limit then return jsonb_build_object('allowed',false,'reason','Limite diário geral atingido.','retryAt',((v_day+1+v_start)::timestamp at time zone v_timezone)); end if;
  select count(*) into v_hour from public.messages where owner_id=p_owner and direction='outbound' and sent_at>=date_trunc('hour',now()) and (metadata->>'newLeadReservation')='true';
  if v_hour>=p_hourly_limit then return jsonb_build_object('allowed',false,'reason','Limite por hora atingido.','retryAt',date_trunc('hour',now())+interval '1 hour'); end if;
  if v_next is not null and v_next>now() then return jsonb_build_object('allowed',false,'reason','Pacing distribuído; próxima vaga ainda não disponível.','retryAt',v_next); end if;
  v_remaining:=greatest(1,p_daily_limit-v_count); v_interval:=greatest(5,extract(epoch from (v_end_local-greatest(v_now_local,v_start_local)))/v_remaining);
  v_next:=greatest(now(),coalesce(v_next,now()))+make_interval(secs=>v_interval);
  update public.daily_usage set outreach_count=outreach_count+1,next_outreach_at=v_next where owner_id=p_owner and usage_date=v_day;
  return jsonb_build_object('allowed',true,'reason',null,'retryAt',v_next,'remainingDailyBudget',v_remaining,'intervalSeconds',v_interval);
end $$;
revoke all on function public.check_outreach_capacity(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.check_outreach_capacity(uuid,uuid,integer,integer) to service_role;

commit;
