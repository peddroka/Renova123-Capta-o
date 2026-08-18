begin;
create table if not exists public.sales_handoff_deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null check (channel in ('qualified_group','qualified_sales_closer','qualified_lead_notice')),
  status text not null default 'processing' check (status in ('processing','sent','failed')),
  idempotency_key text not null,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(owner_id, lead_id, channel),
  unique(idempotency_key)
);
create index if not exists sales_handoff_delivery_lead_idx on public.sales_handoff_deliveries(owner_id, lead_id);

alter table public.sales_handoff_deliveries enable row level security;
create policy sales_handoff_deliveries_owner_select on public.sales_handoff_deliveries
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy sales_handoff_deliveries_owner_insert on public.sales_handoff_deliveries
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy sales_handoff_deliveries_owner_update on public.sales_handoff_deliveries
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

commit;
