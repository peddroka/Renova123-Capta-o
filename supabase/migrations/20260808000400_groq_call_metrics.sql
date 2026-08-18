begin;

alter table public.agent_executions
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists total_tokens integer,
  add column if not exists latency_ms integer,
  add column if not exists success boolean not null default true,
  add column if not exists rate_limited boolean not null default false;

commit;
