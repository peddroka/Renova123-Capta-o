begin;

alter table public.conversations
  add column if not exists first_inbound_at timestamptz,
  add column if not exists first_outbound_at timestamptz,
  add column if not exists qualification_deadline_at timestamptz;

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type in ('lead_replied','lead_interested','lead_stalled','call_requested','demo_requested','demo_scheduled','complaint','aggressive_message','low_confidence','groq_error','whatsapp_disconnected','worker_stopped','daily_limit_reached','queue_failed','material_missing','opt_out_send_attempt'));
alter table public.notifications
  add column if not exists delivery_status text not null default 'pending' check (delivery_status in ('pending','processing','sent','blocked','failed')),
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_available_at timestamptz not null default now(),
  add column if not exists delivery_last_error text,
  add column if not exists delivery_payload jsonb not null default '{}'::jsonb;

commit;
