begin;

create table if not exists public.wolf_calls (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null, operator_id uuid references public.profiles(id) on delete set null,
  direction text not null check (direction in ('outbound','inbound')), status text not null default 'preparing',
  started_at timestamptz, ended_at timestamptz, duration_seconds integer, result text, summary text,
  live_context jsonb not null default '{}'::jsonb, transcript jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists wolf_calls_owner_created_idx on public.wolf_calls(owner_id, created_at desc);
create table if not exists public.wolf_call_turns (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  call_id uuid not null references public.wolf_calls(id) on delete cascade, speaker text not null check (speaker in ('operator','client')),
  text text not null, started_at timestamptz not null default now(), ended_at timestamptz, sequence integer not null,
  partial boolean not null default false, created_at timestamptz not null default now()
);
create index if not exists wolf_turns_call_seq_idx on public.wolf_call_turns(call_id, sequence);
create table if not exists public.wolf_call_insights (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  call_id uuid not null references public.wolf_calls(id) on delete cascade, kind text not null,
  value text not null, confidence numeric(4,3), created_at timestamptz not null default now()
);
alter table public.wolf_calls enable row level security;
alter table public.wolf_call_turns enable row level security;
alter table public.wolf_call_insights enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wolf_calls' and policyname = 'wolf_calls_owner') then
    create policy wolf_calls_owner on public.wolf_calls for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wolf_call_turns' and policyname = 'wolf_turns_owner') then
    create policy wolf_turns_owner on public.wolf_call_turns for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wolf_call_insights' and policyname = 'wolf_insights_owner') then
    create policy wolf_insights_owner on public.wolf_call_insights for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
end $$;

commit;
