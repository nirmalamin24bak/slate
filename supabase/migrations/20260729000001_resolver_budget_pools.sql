-- Audit C3 + M2 — separate the resolver budget by tier, and stop serialising
-- every classification on one row.
--
-- C3 (fairness). There was ONE global 50,000/day fuse for everybody, and users
-- are free, unlimited and anonymous. Per-user is 30 calls/min, so roughly forty
-- throwaway sign-ups sustain 1,200/min and drain the day's ceiling in under an
-- hour — from one laptop, at zero cost. resolver_rate_check then returns false
-- for EVERYONE and every paying Plus subscriber's resolver is dead until 00:00
-- UTC. Migration ...0004's own header flagged this ("a separate, higher pool for
-- paying users lands with the entitlements table"); the entitlements table
-- landed, the separate pool did not.
--
-- Plus now draws from its own reserved pool that free traffic cannot touch. A
-- free-tier flood exhausts the free pool and nothing else. resolver-classify
-- already reads the authoritative entitlement (it computed `isPlus` and then
-- discarded it with `void isPlus`); it now passes it here.
--
-- M2 (throughput). The counter was a single row per day taking
-- `on conflict do update set calls = calls + 1` on every served call. Postgres
-- serialises concurrent writers to a row, so at a few hundred concurrent
-- resolves that row IS the product's throughput ceiling, and the lock wait lands
-- inside the user's latency budget. The counter is now sharded: a user always
-- hits the same bucket, so writers spread across BUCKETS rows, and the ceiling
-- check is a bounded read over them (a read takes no row lock).
--
-- FLAG(nirmal): the two ceilings are still guesses, as 50,000 was. They are
-- deliberately split so the totals are legible rather than merged into one
-- number: free traffic is capped, and Plus has headroom that abuse cannot reach.
-- Revisit against real traffic — see docs/founder-rulings.md.

create table resolver_budget (
  day     date     not null,
  pool    text     not null check (pool in ('free', 'plus')),
  bucket  smallint not null check (bucket >= 0 and bucket < 32),
  calls   integer  not null default 0,
  primary key (day, pool, bucket)
);

alter table resolver_budget enable row level security;
-- No policies on purpose: service role only, like every other resolver table.

-- Carry over whatever the old single-row counter recorded for today, so a deploy
-- mid-day does not hand out a fresh full budget. Everything lands in bucket 0 of
-- the free pool: it is spend that already happened, and attributing it to the
-- cheaper pool is the conservative reading.
insert into resolver_budget (day, pool, bucket, calls)
select day, 'free', 0, calls from resolver_global_budget
on conflict (day, pool, bucket) do nothing;

create or replace function public.resolver_rate_check(
  p_user uuid,
  p_limit integer,
  p_window_seconds integer,
  p_plus boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calls   integer;
  v_pool    text := case when p_plus then 'plus' else 'free' end;
  v_bucket  smallint;
  v_total   bigint;
  v_ceiling integer;
  -- Number of shards. A power of two so the mask is exact, and small enough
  -- that summing them all is a trivial index read.
  c_buckets constant integer := 32;
  -- FLAG(nirmal): launch-scale guesses, as 50,000 was.
  c_free_daily constant integer := 40000;
  c_plus_daily constant integer := 20000;
begin
  -- Per-user sliding window FIRST, unchanged from ...0004: reject a user who is
  -- over their own limit without spending any pool budget on them. This is what
  -- makes the pool counters track SERVED calls rather than attempts.
  insert into resolver_rate_limits as r (user_id, window_start, calls)
  values (p_user, now(), 1)
  on conflict (user_id) do update set
    calls = case
      when r.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else r.calls + 1
    end,
    window_start = case
      when r.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else r.window_start
    end
  returning calls into v_calls;

  if v_calls > p_limit then
    return false;
  end if;

  -- The user is within their limit, so this call will be served. Charge it to
  -- their pool's shard. hashtext is deterministic, so one user always lands on
  -- one bucket and contention divides by c_buckets.
  v_bucket := (abs(hashtext(p_user::text)) % c_buckets)::smallint;
  v_ceiling := case when p_plus then c_plus_daily else c_free_daily end;

  insert into resolver_budget as b (day, pool, bucket, calls)
  values (current_date, v_pool, v_bucket, 1)
  on conflict (day, pool, bucket) do update set calls = b.calls + 1;

  -- Ceiling check is a READ across this pool's shards — no lock, and bounded to
  -- at most c_buckets rows by the primary key.
  select coalesce(sum(calls), 0) into v_total
  from resolver_budget
  where day = current_date and pool = v_pool;

  return v_total <= v_ceiling;
end;
$$;

-- The 3-argument version from ...0004 would otherwise linger, callable and
-- charging the old unsharded counter.
drop function if exists public.resolver_rate_check(uuid, integer, integer);

revoke all on function public.resolver_rate_check(uuid, integer, integer, boolean)
  from public, anon, authenticated;

-- The reaper keeps a week of the new table for spend spot-checks, same as it did
-- for the old one. resolver_global_budget is left in place but no longer written:
-- dropping it would lose the historical spend record it already holds.
create or replace function public.reap_resolver_state()
returns void
language sql
security definer
set search_path = public
as $$
  delete from resolver_rate_limits where window_start < now() - interval '1 day';
  delete from resolver_global_budget where day < current_date - 7;
  delete from resolver_budget where day < current_date - 7;
  delete from resolution_cache where last_hit_at < now() - interval '90 days';
  delete from resolution_cache_pending where observed_at < now() - interval '30 days';
$$;

revoke all on function public.reap_resolver_state() from public, anon, authenticated;
