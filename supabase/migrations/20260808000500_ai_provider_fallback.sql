begin;

alter table public.agent_executions
  add column if not exists fallback_reason text,
  add column if not exists fallback_count integer not null default 0;

create index if not exists agent_executions_provider_created_idx
  on public.agent_executions (owner_id, provider, created_at desc);

commit;
