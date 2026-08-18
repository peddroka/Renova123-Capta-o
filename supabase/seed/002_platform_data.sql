begin;

do $$
declare v_owner uuid; v_agent uuid;
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then
    raise notice 'Crie o administrador de desenvolvimento no Supabase Auth e execute novamente o seed. Nenhuma senha é criada por SQL.';
    return;
  end if;

  insert into public.agent_profiles(owner_id,name,role,description,tone,personality)
  values(v_owner,'Francisco','Assistente comercial','Assistente comercial da Renova123','consultivo','{"style":"natural, profissional e objetivo","preferredLength":"curta"}'::jsonb)
  on conflict(owner_id,name) do update set role=excluded.role,description=excluded.description,updated_at=now()
  returning id into v_agent;

  insert into public.agent_instructions(owner_id,agent_profile_id,category,title,content,priority) values
    (v_owner,v_agent,'safety','Regras de segurança','Nunca invente preços, condições, disponibilidade ou informações ausentes. Respeite opt-outs imediatamente.',10),
    (v_owner,v_agent,'handoff','Atendimento humano','Transfira quando o lead pedir uma pessoa, quando houver reclamação ou quando a confiança for insuficiente.',20),
    (v_owner,v_agent,'scheduling','Agendamento','Somente confirme horários retornados pela disponibilidade persistida.',30)
  on conflict do nothing;

  insert into public.app_settings(owner_id,section,values) values
    (v_owner,'general','{"agentName":"Francisco","companyName":"Renova123","simulationMode":true,"outreachEnabled":false,"globalPause":false,"automationEnabled":false,"timezone":"America/Sao_Paulo"}'::jsonb),
    (v_owner,'outreach','{"dailyLimit":50,"dailyProactiveLimit":50,"hourlyLimit":8,"weekdays":[0,1,2,3,4,5,6],"startTime":"08:00","endTime":"23:00","minIntervalSeconds":5,"maxIntervalSeconds":5,"timezone":"America/Sao_Paulo","followUpsEnabled":false,"maxFollowUps":1,"followUpIntervalHours":72}'::jsonb),
    (v_owner,'material_categories','{"items":["Apresentação","Vídeo","Imagem","Documento","Áudio"]}'::jsonb),
    (v_owner,'handoff_reasons','{"items":["Solicitou atendimento humano","Negociação comercial","Reclamação","Baixa confiança da IA","Dúvida não cadastrada"]}'::jsonb),
    (v_owner,'lead_statuses','{"items":["imported","queued","scheduled","contacting","contacted","awaiting_reply","replied","qualifying","interested","demo_requested","demo_scheduled","handoff","manual_service","no_response","converted","lost","opted_out","invalid","blocked","failed"]}'::jsonb)
  on conflict(owner_id,section) do update set values=excluded.values,updated_at=now();

  update public.system_settings
  set values=jsonb_set(jsonb_set(values,'{followUpsEnabled}','false'::jsonb,true),'{maxFollowUps}','1'::jsonb,true),updated_at=now()
  where owner_id=v_owner and section='outreach';

  insert into public.message_templates(owner_id,name,kind,content,active,use_count,last_used_at)
  select owner_id,name,'initial',content,active,use_count,last_used_at from public.initial_messages where owner_id=v_owner
  on conflict(owner_id,name,kind) do update set content=excluded.content,active=excluded.active,updated_at=now();

  insert into public.integration_connections(owner_id,provider,instance_name,status,settings) values
    (v_owner,'supabase','principal','connected','{}'::jsonb),
    (v_owner,'groq','principal','disconnected','{"mock":true}'::jsonb),
    (v_owner,'evolution','renova123-francisco','disconnected','{"mock":true}'::jsonb)
  on conflict(owner_id,provider,instance_name) do nothing;
end $$;

commit;
