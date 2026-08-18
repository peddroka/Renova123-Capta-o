begin;

create type public.queue_status as enum ('pending','scheduled','processing','completed','retry','failed','cancelled','dead_letter');
create type public.message_direction as enum ('inbound','outbound');
create type public.message_origin as enum ('whatsapp','manual','ai','system','import');
create type public.integration_status as enum ('disconnected','connecting','connected','degraded','failed','disabled');

alter type public.lead_stage add value if not exists 'imported';
alter type public.lead_stage add value if not exists 'scheduled';
alter type public.lead_stage add value if not exists 'contacting';
alter type public.lead_stage add value if not exists 'awaiting_reply';
alter type public.lead_stage add value if not exists 'replied';
alter type public.lead_stage add value if not exists 'qualifying';
alter type public.lead_stage add value if not exists 'demo_requested';
alter type public.lead_stage add value if not exists 'handoff';
alter type public.lead_stage add value if not exists 'manual_service';
alter type public.lead_stage add value if not exists 'no_response';
alter type public.lead_stage add value if not exists 'converted';
alter type public.lead_stage add value if not exists 'invalid';
alter type public.lead_stage add value if not exists 'blocked';
alter type public.lead_stage add value if not exists 'failed';

create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  section text not null check (section ~ '^[a-z][a-z0-9_-]{1,49}$'),
  values jsonb not null default '{}'::jsonb check (jsonb_typeof(values) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, section)
);

create table public.system_secrets_metadata (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  secret_name text not null,
  configured boolean not null default false,
  last_four text check (last_four is null or length(last_four) between 2 and 8),
  rotated_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider, secret_name)
);

create table public.agent_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Francisco',
  role text not null default 'Assistente comercial',
  description text not null default '',
  tone text not null default 'consultivo',
  personality jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, name)
);

create table public.agent_instructions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent_profile_id uuid not null references public.agent_profiles(id) on delete cascade,
  category text not null check (category in ('identity','mission','product','audience','commercial','objections','safety','handoff','scheduling','additional')),
  title text not null,
  content text not null,
  priority integer not null default 100 check (priority between 0 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null default 'general',
  content text not null default '',
  tags text[] not null default '{}',
  source text not null default 'manual',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  knowledge_item_id uuid references public.knowledge_items(id) on delete cascade,
  bucket text not null default 'knowledge' check (bucket = 'knowledge'),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  extraction_status text not null default 'pending' check (extraction_status in ('pending','processing','completed','failed')),
  extracted_text text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'initial' check (kind in ('initial','follow_up','handoff','appointment','system')),
  content text not null check (length(trim(content)) between 10 and 4000),
  variables text[] not null default '{}',
  active boolean not null default true,
  use_count integer not null default 0 check (use_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, name, kind)
);

create table public.lead_batch_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.lead_batches(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  position integer check (position is null or position > 0),
  status text not null default 'pending' check (status in ('pending','scheduled','processing','completed','skipped','cancelled','failed')),
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id, lead_id)
);

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  source text not null default 'system' check (source in ('system','worker','api','admin','ai','webhook','import')),
  actor_id uuid references auth.users(id) on delete set null,
  correlation_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_events_timeline_idx on public.lead_events(lead_id, created_at desc);

create table public.conversation_memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  key text not null check (length(key) between 1 and 100),
  value text not null check (length(value) between 1 and 2000),
  source text not null default 'ai' check (source in ('ai','human','import','system')),
  confidence numeric(4,3) check (confidence between 0 and 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(conversation_id, key)
);

alter table public.messages
  add column if not exists origin public.message_origin not null default 'whatsapp',
  add column if not exists sender text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists material_id uuid references public.materials(id) on delete set null,
  add column if not exists file_path text,
  add column if not exists attempt integer not null default 0 check (attempt >= 0),
  add column if not exists received_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists messages_conversation_timeline_idx on public.messages(conversation_id, created_at);

create table public.outreach_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  batch_id uuid references public.lead_batches(id) on delete set null,
  template_id uuid references public.message_templates(id) on delete set null,
  status public.queue_status not null default 'pending',
  priority integer not null default 100 check (priority between 0 and 1000),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  last_error text,
  deduplication_key text,
  payload jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_response_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  inbound_message_id uuid references public.messages(id) on delete cascade,
  status public.queue_status not null default 'pending',
  priority integer not null default 50 check (priority between 0 and 1000),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  last_error text,
  deduplication_key text,
  payload jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.follow_up_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  status public.queue_status not null default 'scheduled',
  priority integer not null default 150 check (priority between 0 and 1000),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  last_error text,
  deduplication_key text,
  payload jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ declare queue_table text; begin
  foreach queue_table in array array['outreach_queue','ai_response_queue','follow_up_queue'] loop
    execute format('create index %I on public.%I(status, priority, available_at, created_at) where status in (''pending'',''scheduled'',''retry'')', queue_table || '_claim_idx', queue_table);
    execute format('create unique index %I on public.%I(owner_id, deduplication_key) where deduplication_key is not null and status not in (''failed'',''cancelled'',''dead_letter'')', queue_table || '_dedupe_idx', queue_table);
  end loop;
end $$;

create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  outreach_count integer not null default 0 check (outreach_count >= 0),
  inbound_count integer not null default 0 check (inbound_count >= 0),
  ai_response_count integer not null default 0 check (ai_response_count >= 0),
  media_count integer not null default 0 check (media_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  tokens_prompt bigint not null default 0 check (tokens_prompt >= 0),
  tokens_completion bigint not null default 0 check (tokens_completion >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, usage_date)
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('evolution','groq','supabase')),
  instance_name text,
  status public.integration_status not null default 'disconnected',
  external_id text,
  capabilities jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  last_seen_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider, instance_name)
);

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  provider text not null,
  external_event_id text,
  event_type text not null,
  status text not null default 'received' check (status in ('received','processing','processed','ignored','failed')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index integration_events_external_unique on public.integration_events(provider, external_event_id) where external_event_id is not null;

create table public.worker_heartbeats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  instance_id text not null,
  worker_type text not null,
  hostname text not null default '',
  process_id integer,
  version text,
  status text not null default 'starting' check (status in ('starting','running','stopping','stopped','failed')),
  last_heartbeat_at timestamptz not null default now(),
  lock_expires_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, worker_type),
  unique(instance_id)
);

create table public.failed_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  queue_name text not null check (queue_name in ('outreach_queue','ai_response_queue','follow_up_queue','media','appointments','maintenance','legacy_jobs')),
  original_job_id uuid,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  error_code text,
  error_message text not null,
  error_stack text,
  failed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.record_lead_stage_event() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.lead_events(owner_id,lead_id,event_type,from_status,to_status,source,data)
    values(new.owner_id,new.id,'status_changed',case when tg_op='UPDATE' then old.stage::text else null end,new.stage::text,'system','{}'::jsonb);
  end if;
  return new;
end $$;
create trigger leads_stage_event after insert or update of stage on public.leads for each row execute function public.record_lead_stage_event();

do $$ declare item text; begin
  foreach item in array array['app_settings','system_secrets_metadata','agent_profiles','agent_instructions','knowledge_items','knowledge_files','message_templates','lead_batch_members','lead_events','conversation_memories','outreach_queue','ai_response_queue','follow_up_queue','availability_blocks','daily_usage','integration_connections','integration_events','worker_heartbeats','failed_jobs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', item || '_updated_at', item);
  end loop;
  if not exists(select 1 from pg_trigger where tgname='messages_updated_at') then
    create trigger messages_updated_at before update on public.messages for each row execute function public.set_updated_at();
  end if;
end $$;

do $$ declare item text; begin
  foreach item in array array['app_settings','system_secrets_metadata','agent_profiles','agent_instructions','knowledge_items','knowledge_files','message_templates','lead_batch_members','lead_events','conversation_memories','outreach_queue','ai_response_queue','follow_up_queue','availability_blocks','daily_usage','integration_connections','integration_events','worker_heartbeats','failed_jobs'] loop
    execute format('alter table public.%I enable row level security', item);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin() and (owner_id is null or owner_id=auth.uid()))', item || '_admin_select', item);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin() and (owner_id is null or owner_id=auth.uid()))', item || '_admin_insert', item);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin() and (owner_id is null or owner_id=auth.uid())) with check (public.is_admin() and (owner_id is null or owner_id=auth.uid()))', item || '_admin_update', item);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin() and (owner_id is null or owner_id=auth.uid()))', item || '_admin_delete', item);
  end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit) values
  ('knowledge','knowledge',false,52428800),
  ('message-media','message-media',false,52428800),
  ('temporary','temporary',false,26214400)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;

do $$ declare bucket_name text; begin
  foreach bucket_name in array array['knowledge','message-media','temporary'] loop
    execute format('create policy %I on storage.objects for select to authenticated using (bucket_id=%L and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text)', bucket_name || '_admin_read', bucket_name);
    execute format('create policy %I on storage.objects for insert to authenticated with check (bucket_id=%L and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text)', bucket_name || '_admin_insert', bucket_name);
    execute format('create policy %I on storage.objects for update to authenticated using (bucket_id=%L and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id=%L and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text)', bucket_name || '_admin_update', bucket_name, bucket_name);
    execute format('create policy %I on storage.objects for delete to authenticated using (bucket_id=%L and public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text)', bucket_name || '_admin_delete', bucket_name);
  end loop;
end $$;

commit;
