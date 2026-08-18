begin;

alter table public.agent_executions
  drop constraint if exists agent_executions_provider_check,
  add constraint agent_executions_provider_check check (provider in ('groq','gemini'));

commit;
