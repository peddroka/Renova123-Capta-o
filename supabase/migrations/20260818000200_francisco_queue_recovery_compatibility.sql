begin;

-- Compatibility signature for workers that send the lease timeout in milliseconds.
-- Keep this overload without a default: the existing interval overload owns the
-- zero-argument call and remains unambiguous for maintenance jobs.
create or replace function public.recover_stale_queue_items(p_lease_timeout_ms bigint)
returns integer
language sql
security definer
set search_path = public
as $$
  select public.recover_stale_queue_items(
    greatest(1, p_lease_timeout_ms) * interval '1 millisecond'
  );
$$;

revoke all on function public.recover_stale_queue_items(bigint) from public, anon, authenticated;
grant execute on function public.recover_stale_queue_items(bigint) to service_role;

-- Ask PostgREST to refresh its function/schema cache after this transaction.
notify pgrst, 'reload schema';

commit;
