-- Plan D2 — reap the rate-limit bookkeeping tables.
--
-- resolver_rate_limits gains one row per user forever (every anonymous install
-- included), and resolver_global_budget one row per day forever. Neither has a
-- TTL. At scale that is millions of mostly-dead rows and the autovacuum/index
-- overhead they carry. A daily pg_cron job trims both.
--
-- A user whose window row is reaped simply gets a fresh window on their next
-- call (resolver_rate_check upserts) — reaping only removes stale state, never
-- grants extra calls within a live window.

-- pg_cron ships with Supabase but must be enabled once (Dashboard → Database →
-- Extensions, or this line if the role has rights). Jobs live in the cron schema.
create extension if not exists pg_cron;

create or replace function public.reap_resolver_state()
returns void
language sql
security definer
set search_path = public
as $$
  -- Rate-limit rows whose window closed over a day ago: safe to drop.
  delete from resolver_rate_limits where window_start < now() - interval '1 day';
  -- Keep a week of daily budget rows for spot-checking spend; drop older.
  delete from resolver_global_budget where day < current_date - 7;
$$;

-- Daily at 03:30 UTC (09:00 IST, low traffic).
select cron.schedule(
  'reap-resolver-state',
  '30 3 * * *',
  $$select public.reap_resolver_state()$$
);
