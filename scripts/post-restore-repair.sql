-- Run this against a RESTORED database, before letting anything talk to it.
--
-- A restore drill on 29 Jul 2026 (docs/ops-verification.md) found that two
-- things do not survive a Supabase restore, and neither of them shows up in a
-- row count:
--
--   1. EXECUTE revokes on SECURITY DEFINER functions. In the drill every one
--      came back as anon=true, authenticated=true — the default PUBLIC grant.
--      A definer function runs as its owner and bypasses RLS, so a restored
--      production database would let any signed-in user call
--      reap_resolver_state() (mass delete across the resolver tables) and
--      resolver_cache_write() (write the global cache directly). That is not a
--      degraded restore; it is a breach, in a database whose row counts all
--      matched.
--
--   2. pg_cron jobs. They live in the `cron` schema, not in `public`, and did
--      not come back at all. The reapers then never run and
--      resolver_rate_limits / resolution_cache_pending grow without bound,
--      silently, until someone notices the bill or the query times.
--
-- This file is idempotent and safe to run more than once. Run it, then run
-- `node scripts/verify-restore.mjs` again and expect a clean result.

-- ---------------------------------------------------------------------------
-- 1. Re-revoke every SECURITY DEFINER function in public.
-- ---------------------------------------------------------------------------
-- Generated from the catalogue rather than a hand-written list, for the same
-- reason the migration harness sweeps generically: a hand list only re-revokes
-- the functions somebody remembered, and the failure mode is silent.
--
-- SECURITY INVOKER functions are deliberately untouched — the four sync_upsert_*
-- RPCs must stay callable or the app cannot push at all.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    raise notice 'revoked: %', fn.sig;
  end loop;
end $$;

-- sync_guard is SECURITY INVOKER and IS meant to be callable; the loop above
-- leaves it alone, but re-assert it so a future edit cannot quietly break every
-- client push.
grant execute on function public.sync_guard(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Re-schedule the reapers.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

-- cron.schedule on an existing jobname updates it, so this is idempotent.
select cron.schedule('reap-resolver-state', '30 3 * * *', $$select public.reap_resolver_state()$$);
select cron.schedule(
  'reap-anonymous-accounts', '45 3 * * *', $$select public.reap_anonymous_accounts()$$);

-- ---------------------------------------------------------------------------
-- 3. Report, so the operator sees the result rather than assuming it.
-- ---------------------------------------------------------------------------
select 'definer functions still callable by a client role' as check,
       coalesce(string_agg(p.proname, ', '), '(none — correct)') as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'), ('authenticated')) as r(rolname)
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege(r.rolname, p.oid, 'execute');

select 'scheduled jobs' as check, coalesce(string_agg(jobname || ' ' || schedule, '; '), '(none — WRONG)') as result
from cron.job;
