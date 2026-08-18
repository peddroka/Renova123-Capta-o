begin;

alter type public.lead_stage add value if not exists 'opening';
alter type public.lead_stage add value if not exists 'pain_identified';
alter type public.lead_stage add value if not exists 'presenting_solution';
alter type public.lead_stage add value if not exists 'handling_objection';
alter type public.lead_stage add value if not exists 'demo_scheduling';
alter type public.lead_stage add value if not exists 'no_interest';

alter table public.lead_memories
  add column if not exists evidence_type text not null default 'explicit' check (evidence_type in ('explicit','inference','hypothesis')),
  add column if not exists confidence numeric(4,3) not null default 1 check (confidence between 0 and 1);

alter table public.conversation_memories
  add column if not exists evidence_type text not null default 'explicit' check (evidence_type in ('explicit','inference','hypothesis'));

alter table public.conversations
  add column if not exists questions_asked text[] not null default '{}',
  add column if not exists materials_sent uuid[] not null default '{}';

create table if not exists public.agent_executions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  provider text not null default 'groq' check (provider = 'groq'),
  model text not null,
  status text not null check (status in ('completed','rate_limited','model_unavailable','failed','blocked')),
  detected_intent text,
  lead_stage public.lead_stage,
  confidence numeric(4,3) check (confidence between 0 and 1),
  operational_summary text check (length(operational_summary) <= 300),
  context_tokens_estimate integer check (context_tokens_estimate >= 0),
  context_was_summarized boolean not null default false,
  rate_limits jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists agent_executions_owner_created_idx on public.agent_executions(owner_id, created_at desc);

alter table public.agent_executions enable row level security;
create policy agent_executions_admin_select on public.agent_executions for select to authenticated using (public.is_admin() and owner_id=auth.uid());

create or replace function public.apply_lead_opt_out(p_owner uuid, p_lead uuid, p_phone text, p_reason text, p_source text default 'agent')
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':' || p_phone, 0));
  insert into public.suppression_list(owner_id,phone,reason,source,active)
    values(p_owner,p_phone,left(p_reason,1000),left(p_source,100),true)
    on conflict(phone) do update set owner_id=excluded.owner_id,reason=excluded.reason,source=excluded.source,active=true,updated_at=now();
  update public.leads set stage='opted_out',opted_out_at=now(),automation_paused=true,human_active=false,updated_at=now() where owner_id=p_owner and id=p_lead;
  update public.conversations set status='closed',human_active=false,updated_at=now() where owner_id=p_owner and lead_id=p_lead;
  update public.follow_ups set status='cancelled',updated_at=now() where owner_id=p_owner and lead_id=p_lead and status='scheduled';
  update public.outreach_queue set status='cancelled',locked_at=null,locked_by=null,updated_at=now() where owner_id=p_owner and lead_id=p_lead and status in ('pending','scheduled','retry');
  update public.ai_response_queue set status='cancelled',locked_at=null,locked_by=null,updated_at=now() where owner_id=p_owner and lead_id=p_lead and status in ('pending','scheduled','retry');
  update public.follow_up_queue set status='cancelled',locked_at=null,locked_by=null,updated_at=now() where owner_id=p_owner and lead_id=p_lead and status in ('pending','scheduled','retry');
  update public.jobs set status='cancelled',locked_at=null,locked_by=null,updated_at=now() where owner_id=p_owner and status='pending' and (payload->>'leadId'=p_lead::text or payload->>'phone'=p_phone);
  insert into public.audit_logs(owner_id,actor_id,action,entity_type,entity_id,details) values(p_owner,p_owner,'lead.opted_out','lead',p_lead,jsonb_build_object('reason',left(p_reason,500),'source',p_source));
  return true;
end; $$;

revoke all on function public.apply_lead_opt_out(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_lead_opt_out(uuid,uuid,text,text,text) to service_role;

commit;
