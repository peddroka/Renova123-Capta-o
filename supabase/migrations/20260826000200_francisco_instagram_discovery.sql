begin;

-- Refresh only Francisco's first-contact pool. The live campaign lists are sourced
-- from Instagram, so the opener can be transparent about where the contact came from
-- while postponing the Renova123 presentation until the lead asks or discovery creates context.
do $$
declare
  v_agent public.agents%rowtype;
  v_openers text[] := array[
    'Oi, peguei seu contato no Instagram. Falo com o dono da ótica?',
    'Oi, tudo bem? Vi o contato da ótica no Instagram. É você que é o dono?',
    'Bom dia! Peguei esse contato no Instagram. Consigo falar com o dono da ótica por aqui?',
    'Boa tarde! Achei o contato de vocês no Instagram. Falo com o proprietário da ótica?',
    'Oi! Peguei seu contato pelo Instagram. Você é o dono da ótica?',
    'Tudo bem? Encontrei o número da ótica no Instagram. É com o dono que eu tô falando?'
  ];
  v_content text;
  v_index integer := 0;
begin
  for v_agent in select * from public.agents where slug='francisco' loop
    update public.message_templates
       set active=false,updated_at=now()
     where owner_id=v_agent.owner_id and agent_id=v_agent.agent_id and kind='initial';

    foreach v_content in array v_openers loop
      v_index := v_index + 1;
      insert into public.message_templates(owner_id,agent_id,name,kind,content,active,use_count)
      values(v_agent.owner_id,v_agent.agent_id,'Instagram '||lpad(v_index::text,2,'0'),'initial',v_content,true,0)
      on conflict(owner_id,name,kind) do update
        set agent_id=excluded.agent_id,content=excluded.content,active=true,updated_at=now();
    end loop;
    v_index := 0;
  end loop;
end $$;

commit;
