begin;

create or replace function public.audit_to_notification() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_type text;
  v_level text;
  v_entity_id uuid;
begin
  v_type := case
    when new.action = 'lead.replied' then 'lead_replied'
    when new.action = 'lead.interested' then 'lead_interested'
    when new.action = 'call.requested' then 'call_requested'
    when new.action = 'demo.requested' then 'demo_requested'
    when new.action = 'demo.scheduled' then 'demo_scheduled'
    when new.action = 'lead.complaint' then 'complaint'
    when new.action = 'lead.aggressive' then 'aggressive_message'
    when new.action = 'agent.low_confidence' then 'low_confidence'
    when new.action = 'groq.error' then 'groq_error'
    when new.action = 'whatsapp.disconnected' then 'whatsapp_disconnected'
    when new.action = 'worker.stopped' then 'worker_stopped'
    when new.action = 'outreach.daily_limit_reached' then 'daily_limit_reached'
    when new.action in ('queue.failed','queue.dead_letter') then 'queue_failed'
    when new.action = 'material.missing' then 'material_missing'
    when new.action = 'optout.send_blocked' then 'opt_out_send_attempt'
  end;
  if v_type is null then return new; end if;
  v_level := case when v_type in ('groq_error','whatsapp_disconnected','worker_stopped','queue_failed','opt_out_send_attempt') then 'critical' when v_type in ('complaint','aggressive_message','low_confidence','daily_limit_reached','material_missing') then 'warning' else 'info' end;
  if new.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then v_entity_id := new.entity_id::uuid; end if;
  insert into public.notifications(owner_id,type,level,title,body,lead_id,conversation_id,entity_id)
  values(new.owner_id,v_type,v_level,replace(initcap(replace(v_type,'_',' ')), 'Groq', 'Groq'),left(coalesce(new.details->>'message',new.action),500),new.lead_id,new.conversation_id,v_entity_id);
  return new;
end $$;

commit;
