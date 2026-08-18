begin;
alter table public.conversations
  add column if not exists qualification_status text not null default 'discovering' check (qualification_status in ('discovering','qualified','stalled','disqualified')),
  add column if not exists qualification_score numeric(5,2) not null default 0 check (qualification_score between 0 and 100),
  add column if not exists handoff_type text check (handoff_type in ('sales_qualified','human_requested','low_confidence','technical','pricing','other')),
  add column if not exists marilia_consent text not null default 'not_asked' check (marilia_consent in ('not_asked','pending','granted','denied')),
  add column if not exists qualification_updated_at timestamptz;
alter table public.handoffs add column if not exists handoff_type text check (handoff_type in ('sales_qualified','human_requested','low_confidence','technical','pricing','other'));
commit;
