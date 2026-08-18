-- Execute após criar o primeiro administrador no Supabase Auth.
do $$
declare v_owner uuid; v_messages text[]; v_message text; v_index integer:=0;
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then raise notice 'Crie o administrador no Supabase Auth antes do seed.'; return; end if;

  insert into public.system_settings(owner_id,section,values) values
  (v_owner,'general','{"agentName":"Francisco","companyName":"Renova 123","simulationMode":true,"realSendingEnabled":false,"globalPause":false,"automationEnabled":false,"timezone":"America/Sao_Paulo","uploadLimitMb":25}'),
  (v_owner,'outreach','{"dailyLimit":50,"dailyProactiveLimit":50,"hourlyLimit":8,"weekdays":[0,1,2,3,4,5,6],"startTime":"08:00","endTime":"22:00","minIntervalSeconds":5,"maxIntervalSeconds":5,"timezone":"America/Maceio","maxConsecutiveFailures":5,"autoPause":true,"followUpsEnabled":true,"maxFollowUps":3,"followUpIntervalHours":48,"batchPriority":"priority"}'),
  (v_owner,'mind','{"agentName":"Francisco","role":"Assistente comercial","presentation":"Assistente comercial da Renova 123","mission":"","primaryGoal":"","secondaryGoal":"","communicationStyle":"Natural, profissional e objetivo","tone":"Consultivo","personality":"Atencioso, curioso e direto","preferredLength":"Curta","targetAudience":"Proprietários e gestores de óticas","companyDescription":"","productDescription":"","benefits":"","features":"","differentiators":"","prices":"","commercialTerms":"","multiStoreDiscount":"","referralProgram":"","freeTrial":"","demoDuration":"45 minutos","objections":"","faq":"","mandatoryRules":"","forbiddenInformation":"","hotLeadCriteria":"","handoffCriteria":"","additionalInstructions":""}'),
  (v_owner,'groq','{"model":"llama-3.3-70b-versatile","temperature":0.35,"configured":false}')
  on conflict(owner_id,section) do nothing;

  v_messages:=array[
    'Olá! Aqui é o {{agente}}, assistente comercial da {{empresa}}. Posso te fazer uma pergunta rápida sobre a gestão da sua ótica?',
    'Oi! Trabalho com a {{empresa}} e ajudamos óticas a organizar melhor a operação. Faz sentido conversarmos por alguns minutos?',
    'Olá! Cheguei até seu contato pela {{origem}}. Sou o {{agente}}, da {{empresa}}. Como vocês organizam hoje vendas e estoque?',
    'Tudo bem? A {{empresa}} criou o {{produto}} para simplificar a rotina de óticas. Posso entender um pouco do seu cenário?',
    'Oi! Uma pergunta direta: qual parte da gestão da ótica mais toma tempo hoje? Aqui é o {{agente}}, da {{empresa}}.',
    'Olá! Sou o {{agente}}, da {{empresa}}. Estamos conversando com óticas sobre desafios de gestão. Qual é o principal por aí?',
    'Oi! A {{empresa}} trabalha exclusivamente com soluções para óticas. Posso te contar brevemente por que entrei em contato?',
    'Olá! Vim pela {{origem}} e queria entender se melhorar a organização da ótica está entre as prioridades deste momento.',
    'Tudo bem? Aqui é o {{agente}}. O {{produto}} reúne áreas importantes da ótica em um só sistema. Como é a operação de vocês hoje?',
    'Oi! Posso fazer uma pergunta rápida? O que vocês gostariam de acompanhar melhor na ótica hoje?',
    'Olá! Falo da {{empresa}}. Temos ajudado gestores a enxergar a operação com mais clareza. Esse tema faz sentido para você?',
    'Oi! Aqui é o {{agente}}, assistente comercial da {{empresa}}. Vocês usam hoje um sistema específico para óticas?',
    'Olá! Encontrei seu contato por {{origem}}. Queria entender se a gestão da ótica está fluindo como você gostaria.',
    'Tudo certo? Trabalho com o {{produto}}, da {{empresa}}. Posso entender rapidamente como vocês controlam a rotina comercial?',
    'Oi! A rotina de estoque, vendas e clientes costuma exigir bastante das óticas. Qual dessas áreas mais pede atenção por aí?',
    'Olá! Sou o {{agente}}, da {{empresa}}. Posso compartilhar uma ideia para simplificar a gestão da sua ótica?',
    'Oi! Estamos ouvindo gestores de óticas para entender os desafios mais comuns. Posso saber qual é o seu hoje?',
    'Olá! A {{empresa}} desenvolve o {{produto}} para óticas. Se fizer sentido, posso explicar em poucas mensagens como funciona.',
    'Tudo bem? Vim pela {{origem}}. Vocês pretendem melhorar algum processo da ótica nos próximos meses?',
    'Oi! Aqui é o {{agente}}. Prometo ser breve: qual ponto da gestão da ótica você mais gostaria de simplificar?'
  ];
  foreach v_message in array v_messages loop v_index:=v_index+1; insert into public.initial_messages(owner_id,name,content) values(v_owner,'Abertura '||lpad(v_index::text,2,'0'),v_message) on conflict do nothing; end loop;

  insert into public.availability_rules(owner_id,weekday,start_time,end_time,duration_minutes,buffer_minutes,min_notice_hours)
  select v_owner,weekday,'09:00'::time,'17:00'::time,45,15,24 from generate_series(1,5) weekday on conflict do nothing;
end $$;
