begin;

create or replace function public.sync_message_template_to_legacy() returns trigger
language plpgsql security definer set search_path=public as $$
declare legacy_id uuid;
begin
  if new.kind <> 'initial' then return new; end if;
  select id into legacy_id from public.initial_messages where owner_id=new.owner_id and name=new.name order by created_at limit 1;
  if legacy_id is null then
    insert into public.initial_messages(owner_id,name,content,active,use_count,last_used_at)
    values(new.owner_id,new.name,new.content,new.active,new.use_count,new.last_used_at);
  else
    update public.initial_messages set content=new.content,active=new.active,use_count=new.use_count,last_used_at=new.last_used_at,updated_at=now() where id=legacy_id;
  end if;
  return new;
end $$;
create trigger message_templates_legacy_sync after insert or update on public.message_templates for each row execute function public.sync_message_template_to_legacy();

create or replace function public.get_available_demo_slots(p_owner uuid,p_from timestamptz default now(),p_limit integer default 8)
returns table(starts_at timestamptz,ends_at timestamptz) language sql stable security definer set search_path=public as $$
with days as (select generate_series((p_from at time zone 'America/Sao_Paulo')::date,(p_from at time zone 'America/Sao_Paulo')::date+30,interval '1 day')::date as generated_date),
rules as (select r.*,d.generated_date from public.availability_rules r join days d on extract(dow from d.generated_date)=r.weekday where r.owner_id=p_owner and r.active),
slots as (select gs as start_at,gs+make_interval(mins=>r.duration_minutes) as end_at,r.min_notice_hours from rules r cross join lateral generate_series((r.generated_date+r.start_time) at time zone 'America/Sao_Paulo',((r.generated_date+r.end_time) at time zone 'America/Sao_Paulo')-make_interval(mins=>r.duration_minutes),make_interval(mins=>r.duration_minutes+r.buffer_minutes)) gs)
select s.start_at,s.end_at from slots s
where s.start_at>=greatest(p_from,now()+make_interval(hours=>s.min_notice_hours))
  and not exists(select 1 from public.appointments a where a.owner_id=p_owner and a.status in ('pending','scheduled') and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(s.start_at,s.end_at,'[)'))
  and not exists(select 1 from public.availability_blocks b where b.owner_id=p_owner and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(s.start_at,s.end_at,'[)'))
  and not exists(select 1 from public.blocked_slots b where b.owner_id=p_owner and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(s.start_at,s.end_at,'[)'))
order by s.start_at limit least(greatest(p_limit,1),50);
$$;
revoke all on function public.get_available_demo_slots(uuid,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.get_available_demo_slots(uuid,timestamptz,integer) to service_role;

commit;
