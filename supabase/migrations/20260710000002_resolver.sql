-- Resolver server-side support (spec/05, plan Phase 2).
--
-- Two service-role-only functions back the resolver-classify Edge Function:
--   * resolver_rate_check   — atomic fixed-window per-user rate limit
--   * resolver_cache_write  — validated upsert into resolution_cache
--
-- Clients never touch either: EXECUTE is revoked from anon/authenticated, and
-- resolver_rate_limits has RLS enabled with no policies (deny-all; the
-- service role bypasses RLS). resolution_cache stays select-only for clients
-- exactly as migration 0001 left it.

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

create table resolver_rate_limits (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  window_start  timestamptz not null default now(),
  calls         integer not null default 1
);

alter table resolver_rate_limits enable row level security;
-- No policies on purpose: nothing here is client data.

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
begin
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

  return v_calls <= p_limit;
end;
$$;

revoke all on function public.resolver_rate_check(uuid, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cache write
-- ---------------------------------------------------------------------------
-- The only write path into resolution_cache (spec/04). Re-validates
-- everything the Edge Function claims, at the data layer, so a compromised or
-- buggy function still cannot poison the cache:
--   * intent must be one of the six
--   * confidence must clear the 0.6 floor
--   * food/exercise refs must exist in the GLOBAL reference tables —
--     custom_dishes refs are rejected: the cache is shared across users and
--     must never resolve one user's "mummy's dal" for everyone
--   * weight/water/steps/sleep never carry a ref
-- Invalid input is dropped silently: the cache is an optimisation, not truth.

create or replace function public.resolver_cache_write(
  p_key text,
  p_intent text,
  p_ref text,
  p_qty numeric,
  p_unit text,
  p_confidence numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or length(p_key) < 1 or length(p_key) > 200 then return; end if;
  if p_intent not in ('food', 'exercise', 'weight', 'water', 'steps', 'sleep') then return; end if;
  if p_confidence is null or p_confidence < 0.6 or p_confidence > 1 then return; end if;
  if p_qty is not null and (p_qty <= 0 or p_qty > 100000) then return; end if;

  if p_intent in ('food', 'exercise') then
    if p_ref is null then return; end if;
    if p_intent = 'food'
       and not exists (select 1 from dishes where id = p_ref)
       and not exists (select 1 from packaged_foods where barcode = p_ref) then
      return;
    end if;
    if p_intent = 'exercise'
       and not exists (select 1 from exercises where id = p_ref) then
      return;
    end if;
  else
    p_ref := null;
  end if;

  insert into resolution_cache (normalized_text, intent, resolved_ref, qty, unit, confidence)
  values (p_key, p_intent, p_ref, p_qty, p_unit, p_confidence)
  on conflict (normalized_text) do update
    set hit_count = resolution_cache.hit_count + 1;
end;
$$;

revoke all on function public.resolver_cache_write(text, text, text, numeric, text, numeric)
  from public, anon, authenticated;
