begin;

create table if not exists public.daily_cadence_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  status text not null default 'planned' check (status in ('planned','processing','completed','failed')),
  daily_budget integer not null check (daily_budget > 0),
  follow_up_count integer not null default 0 check (follow_up_count >= 0),
  new_lead_count integer not null default 0 check (new_lead_count >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  unique(owner_id, plan_date)
);

create index if not exists daily_cadence_plans_owner_date_idx on public.daily_cadence_plans(owner_id, plan_date desc);
alter table public.daily_cadence_plans enable row level security;
create policy daily_cadence_plans_admin_select on public.daily_cadence_plans for select to authenticated using (public.is_admin() and owner_id = auth.uid());
create policy daily_cadence_plans_admin_insert on public.daily_cadence_plans for insert to authenticated with check (public.is_admin() and owner_id = auth.uid());
create policy daily_cadence_plans_admin_update on public.daily_cadence_plans for update to authenticated using (public.is_admin() and owner_id = auth.uid()) with check (public.is_admin() and owner_id = auth.uid());

commit;
