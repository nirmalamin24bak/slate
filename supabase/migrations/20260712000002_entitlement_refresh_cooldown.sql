-- Security M2 — rate-limit the entitlement-refresh reconciliation path.
--
-- entitlement-refresh is JWT-verified but had no throttle. Each call makes an
-- outbound request to RevenueCat's REST API under Slate's secret key
-- (REVENUECAT_SECRET_API_KEY), so an authenticated user could loop it and
-- generate unbounded outbound traffic on Slate's RC account — a cost/throttle
-- vector that degrades reconciliation for everyone. Legitimate use is rare:
-- the client calls it only when the SDK and server disagree, or after
-- restorePurchases. A short per-user cooldown covers every honest case.
--
-- Same shape as resolver_rate_check (migration 0002): SECURITY DEFINER,
-- atomic compare-and-set, deny-all RLS on the table, revoked from anon/
-- authenticated so only the service role can call it.

create table entitlement_refresh_limits (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  last_call  timestamptz not null default now()
);

alter table entitlement_refresh_limits enable row level security;
-- No policies on purpose: nothing here is client data.

-- Returns true if the call is allowed (and records it); false if the caller is
-- still inside the cooldown window. First call for a user always allows.
create or replace function public.entitlement_refresh_check(
  p_user uuid,
  p_cooldown_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now      timestamptz := now();
  v_updated  timestamptz;
begin
  -- Upsert, but only advance last_call when the cooldown has elapsed (or this
  -- is the first call). The window therefore anchors to the last *allowed*
  -- call, so a tight loop cannot keep pushing it forward. We then compare the
  -- stored last_call to v_now: equal means this call advanced it → allowed;
  -- otherwise it was left at the earlier time → denied. now() is stable across
  -- the statement, so the equality is exact. FOR UPDATE via the upsert's row
  -- lock serializes concurrent same-user calls.
  insert into entitlement_refresh_limits as r (user_id, last_call)
  values (p_user, v_now)
  on conflict (user_id) do update set
    last_call = case
      when r.last_call < v_now - make_interval(secs => p_cooldown_seconds)
        then v_now
      else r.last_call
    end
  returning last_call into v_updated;

  return v_updated = v_now;
end;
$$;

revoke all on function public.entitlement_refresh_check(uuid, integer)
  from public, anon, authenticated;
