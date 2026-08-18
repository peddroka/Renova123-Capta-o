begin;

alter table public.leads
  add column if not exists initial_outreach_sent_at timestamptz,
  add column if not exists qualified_at timestamptz,
  add column if not exists stalled_at timestamptz,
  add column if not exists outreach_template_strategy text,
  add column if not exists ai_provider text,
  add column if not exists ai_model text;

create index if not exists leads_initial_outreach_hour_idx on public.leads(owner_id, initial_outreach_sent_at);

create or replace function public.capture_outreach_template_strategy() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_name text;
begin
  if new.template_id is not null then
    select name into v_name from public.message_templates where id=new.template_id;
    if v_name is not null then new.payload:=jsonb_set(coalesce(new.payload,'{}'::jsonb),'{templateStrategy}',to_jsonb(v_name),true); end if;
  end if;
  return new;
end $$;
drop trigger if exists outreach_template_strategy on public.outreach_queue;
create trigger outreach_template_strategy before insert on public.outreach_queue for each row execute function public.capture_outreach_template_strategy();

-- Mantém a atribuição no horário da primeira abordagem, independente da hora da resposta.
create or replace function public.get_outreach_hour_analytics(p_owner uuid, p_timezone text default 'America/Maceio')
returns jsonb language sql stable security definer set search_path=public as $$
  with buckets as (
    select generate_series(8,22) as hour
  ),
  sampled as (
    select l.initial_outreach_sent_at,
      l.qualified_at,
      c.first_inbound_at
    from public.leads l
    left join public.conversations c on c.lead_id=l.id and c.owner_id=l.owner_id
    where l.owner_id=p_owner and l.initial_outreach_sent_at is not null
  ),
  grouped as (
    select b.hour,
      count(s.*) as sent,
      count(s.*) filter(where s.first_inbound_at is not null) as responded,
      count(s.*) filter(where s.qualified_at is not null) as qualified,
      percentile_cont(0.5) within group(order by extract(epoch from (s.first_inbound_at-s.initial_outreach_sent_at))/60)
        filter(where s.first_inbound_at is not null and s.first_inbound_at>=s.initial_outreach_sent_at) as median_response_minutes
    from buckets b
    left join sampled s on extract(hour from s.initial_outreach_sent_at at time zone p_timezone)=b.hour
    group by b.hour
  )
  select jsonb_build_object(
    'timezone',p_timezone,
    'hours',coalesce((select jsonb_agg(jsonb_build_object(
      'hour',hour,'label',lpad(hour::text,2,'0')||':00','sent',sent,'responded',responded,
      'responseRate',case when sent=0 then 0 else responded::numeric/sent end,
      'qualified',qualified,'qualificationRate',case when sent=0 then 0 else qualified::numeric/sent end,
      'medianMinutesToFirstResponse',median_response_minutes
    ) order by hour) from grouped),'[]'::jsonb),
    'bestResponseHour',null,'bestQualificationHour',null,'minimumSampleSize',10,
    'totalSample',coalesce((select sum(sent) from grouped),0)
  );
$$;
revoke all on function public.get_outreach_hour_analytics(uuid,text) from public,anon,authenticated;
grant execute on function public.get_outreach_hour_analytics(uuid,text) to service_role;

commit;
