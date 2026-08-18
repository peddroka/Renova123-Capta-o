begin;

create table if not exists public.outreach_cadence_state (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  status text not null default 'active' check (status in ('active','responded','qualified','no_interest','opted_out','demo_requested','handed_off','exhausted','paused')),
  flow_step smallint not null default 1 check (flow_step between 1 and 6),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  responded_at timestamptz,
  exited_at timestamptz,
  exit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outreach_cadence_due_idx on public.outreach_cadence_state(owner_id, status, next_attempt_at);
create index if not exists outreach_cadence_step_idx on public.outreach_cadence_state(owner_id, flow_step, status);

insert into public.outreach_cadence_state(owner_id, lead_id, status, flow_step, attempt_count, last_attempt_at, created_at, updated_at)
select l.owner_id, l.id, case when l.stage='opted_out' then 'opted_out' when l.automation_paused then 'paused' else 'active' end,
  1, case when l.approached_at is not null then 1 else 0 end, l.approached_at, l.created_at, now()
from public.leads l
on conflict (lead_id) do nothing;

create or replace function public.mark_cadence_responded(p_owner uuid, p_lead uuid, p_at timestamptz default now())
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.outreach_cadence_state(owner_id, lead_id, status, responded_at, exited_at, exit_reason)
  values(p_owner,p_lead,'responded',p_at,p_at,'inbound_received')
  on conflict (lead_id) do update set status='responded',responded_at=coalesce(outreach_cadence_state.responded_at,excluded.responded_at),exited_at=coalesce(outreach_cadence_state.exited_at,excluded.exited_at),exit_reason='inbound_received',updated_at=now();
end $$;

revoke all on function public.mark_cadence_responded(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.mark_cadence_responded(uuid,uuid,timestamptz) to service_role;

commit;
