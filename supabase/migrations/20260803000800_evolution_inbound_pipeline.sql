-- Atomic Evolution API v2.3.6 inbound pipeline.
begin;
alter table public.conversations
  add column if not exists unread_count integer not null default 0 check (unread_count >= 0),
  add column if not exists last_inbound_at timestamptz;

alter table public.messages
  add column if not exists transcription text,
  add column if not exists media_mime_type text;

alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type in (
  'outreach','inbound_reply','follow_up','send_material','opt_out',
  'appointment_reminder','evolution_event','maintenance'
));

create or replace function public.persist_inbound_evolution_event(p_owner uuid, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := p_event->>'phone';
  v_lead public.leads%rowtype;
  v_conversation public.conversations%rowtype;
  v_message_id uuid;
  v_occurred_at timestamptz := coalesce((p_event->>'occurredAt')::timestamptz, now());
  v_message_type text := case when p_event->>'messageType' in ('text','image','video','audio','document') then p_event->>'messageType' else 'text' end;
begin
  if p_owner is null or v_phone !~ '^55[0-9]{10,11}$' then
    raise exception 'owner ou telefone inbound inválido';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':' || v_phone, 0));

  insert into public.leads(owner_id, phone, name, source, stage, last_contact_at, metadata)
  values (p_owner, v_phone, nullif(p_event->>'pushName',''), 'whatsapp_inbound', 'engaged', v_occurred_at, jsonb_build_object('lastEvolutionEventId', p_event->>'eventId'))
  on conflict (owner_id, phone) do update set
    name = coalesce(public.leads.name, excluded.name),
    last_contact_at = greatest(coalesce(public.leads.last_contact_at, excluded.last_contact_at), excluded.last_contact_at),
    stage = case when public.leads.stage in ('new','queued','contacted') then 'engaged'::public.lead_stage else public.leads.stage end,
    updated_at = now()
  returning * into v_lead;

  insert into public.conversations(owner_id, lead_id, status, stage, human_active, last_message_at, last_inbound_at, unread_count)
  values (p_owner, v_lead.id, case when v_lead.human_active then 'paused' else 'active' end, v_lead.stage, v_lead.human_active, v_occurred_at, v_occurred_at, 1)
  on conflict (lead_id) do update set
    last_message_at = greatest(coalesce(public.conversations.last_message_at, excluded.last_message_at), excluded.last_message_at),
    last_inbound_at = greatest(coalesce(public.conversations.last_inbound_at, excluded.last_inbound_at), excluded.last_inbound_at),
    unread_count = public.conversations.unread_count + 1,
    updated_at = now()
  returning * into v_conversation;

  insert into public.messages(owner_id, lead_id, conversation_id, direction, sender_type, origin, content, message_type, external_id, status, raw_data, received_at, media_mime_type, transcription, file_path)
  values (p_owner, v_lead.id, v_conversation.id, 'inbound', 'lead', 'whatsapp', left(coalesce(p_event->>'text',''), 16000), v_message_type, nullif(p_event->>'externalMessageId',''), 'received', coalesce(p_event->'raw','{}'::jsonb), v_occurred_at, p_event#>>'{raw,data,message,mimetype}', nullif(p_event->>'transcription',''), nullif(p_event->>'mediaPath',''))
  on conflict (external_id) where external_id is not null do nothing
  returning id into v_message_id;

  if v_message_id is not null then
    update public.follow_ups set status = 'cancelled', updated_at = now()
      where owner_id = p_owner and lead_id = v_lead.id and status = 'scheduled';
    update public.follow_up_queue set status = 'cancelled', locked_at = null, locked_by = null, updated_at = now()
      where owner_id = p_owner and lead_id = v_lead.id and status in ('pending','scheduled','retry');
    insert into public.daily_usage(owner_id, usage_date, inbound_count)
      values (p_owner, (v_occurred_at at time zone 'America/Sao_Paulo')::date, 1)
      on conflict (owner_id, usage_date) do update set inbound_count = public.daily_usage.inbound_count + 1, updated_at = now();
  end if;

  return jsonb_build_object(
    'leadId', v_lead.id,
    'conversationId', v_conversation.id,
    'messageId', v_message_id,
    'inserted', v_message_id is not null,
    'humanActive', v_lead.human_active,
    'automationPaused', v_lead.automation_paused,
    'optedOut', v_lead.stage = 'opted_out'
  );
end;
$$;

revoke all on function public.persist_inbound_evolution_event(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persist_inbound_evolution_event(uuid, jsonb) to service_role;

comment on function public.persist_inbound_evolution_event(uuid, jsonb) is
  'Persiste um evento inbound normalizado sob advisory lock por owner/telefone; uso exclusivo do service role.';

commit;
