-- Plan A5 — global-budget accounting fix.
--
-- 0003's resolver_rate_check incremented the single global-budget row FIRST,
-- on every call, before the per-user check — so calls a user was ALREADY over
-- their per-minute limit for still burned global budget, and the 50k ceiling
-- measured attempts rather than served calls. One abuser cycling fresh anon
-- users could exhaust the day's ceiling and 429 every paying user.
--
-- Fix: evaluate the cheap per-user window FIRST; return false without touching
-- the global counter when the user is over their own limit. Only a call that
-- will actually be served increments the global counter. The counter now
-- tracks served calls, so the ceiling maps to real spend.
--
-- FLAG(nirmal): still a single shared 50k/day pool. A separate, higher pool
-- for paying users lands with the entitlements table (plan B2) — this only
-- fixes the accounting, not the shared-fuse fairness.

create or replace function public.resolver_rate_check(
  p_user uuid,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calls integer;
  v_global integer;
begin
  -- Per-user sliding window FIRST. Reject over-limit users without spending
  -- any global budget on them.
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

  -- The user is within their limit, so this call will be served. Count it
  -- against the global daily ceiling now.
  insert into resolver_global_budget as g (day, calls)
  values (current_date, 1)
  on conflict (day) do update set calls = g.calls + 1
  returning calls into v_global;

  return v_global <= 50000;
end;
$$;

revoke all on function public.resolver_rate_check(uuid, integer, integer)
  from public, anon, authenticated;
