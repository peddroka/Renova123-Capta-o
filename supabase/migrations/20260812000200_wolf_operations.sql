begin;
create table if not exists public.wolf_lead_state (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 lead_id uuid not null unique references public.leads(id) on delete cascade,
 status text not null default 'not_called' check (status in ('not_called','called','no_answer','answered','busy','callback','interested','converted','not_interested','invalid','closed')),
 cohort_date date not null default (now() at time zone 'America/Maceio')::date, first_call_at timestamptz, last_call_at timestamptz, next_call_at timestamptz,
 total_attempts integer not null default 0 check (total_attempts >= 0), answered_attempts integer not null default 0 check (answered_attempts >= 0), converted_at timestamptz, conversion_type text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists wolf_lead_state_owner_status_idx on public.wolf_lead_state(owner_id,status);
create index if not exists wolf_lead_state_owner_next_call_idx on public.wolf_lead_state(owner_id,next_call_at);
create index if not exists wolf_lead_state_owner_cohort_idx on public.wolf_lead_state(owner_id,cohort_date);
create index if not exists wolf_lead_state_owner_converted_idx on public.wolf_lead_state(owner_id,converted_at);
create table if not exists public.wolf_call_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, lead_id uuid not null references public.leads(id) on delete cascade,
 call_id uuid references public.wolf_calls(id) on delete set null, event_type text not null, occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb
);
create index if not exists wolf_call_events_owner_time_idx on public.wolf_call_events(owner_id,occurred_at desc);
create index if not exists wolf_call_events_lead_idx on public.wolf_call_events(lead_id,occurred_at desc);
alter table public.wolf_lead_state enable row level security; alter table public.wolf_call_events enable row level security;
do $$ begin
 if not exists (select 1 from pg_policies where schemaname='public' and tablename='wolf_lead_state' and policyname='wolf_lead_state_owner') then create policy wolf_lead_state_owner on public.wolf_lead_state for all using (owner_id=auth.uid()) with check (owner_id=auth.uid()); end if;
 if not exists (select 1 from pg_policies where schemaname='public' and tablename='wolf_call_events' and policyname='wolf_call_events_owner') then create policy wolf_call_events_owner on public.wolf_call_events for all using (owner_id=auth.uid()) with check (owner_id=auth.uid()); end if;
end $$;
commit;
