begin;

-- Extend the existing operational state machine without replacing or copying lead history.
alter table public.wolf_lead_state drop constraint if exists wolf_lead_state_status_check;
alter table public.wolf_lead_state add constraint wolf_lead_state_status_check
  check (status in ('not_called','called','no_answer','answered','busy','callback','has_system','interested','converted','no_interest','not_interested','invalid','closed'));

create index if not exists wolf_lead_state_owner_queue_idx
  on public.wolf_lead_state(owner_id, status, next_call_at, total_attempts, last_call_at);

commit;
