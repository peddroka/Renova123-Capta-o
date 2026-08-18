begin;

alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type in (
  'outreach','inbound_reply','follow_up','send_material','opt_out',
  'appointment_reminder','evolution_event','maintenance','ai_send'
));

commit;
