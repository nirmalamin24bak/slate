-- Phase 2 security self-review fixes (findings F1 and F3).
--
-- F1 — cache-fill DoS / poisoning: resolver_cache_write now only accepts
-- short keys (the >90% hit rate lives entirely in short head-of-distribution
-- phrases), enforces the client's per-intent quantity caps instead of one
-- loose bound, and stops writing once the table's estimated row count passes
-- a budget. The cache is an optimisation; refusing a write is always safe.
--
-- F3 — model-spend ceiling: resolver_rate_check additionally enforces a
-- global daily call budget so unlimited free anonymous sign-ups cannot run
-- up an unbounded model bill. FLAG(nirmal): 50,000 calls/day is a launch-
-- scale guess; revisit against real traffic.

create table resolver_global_budget (
  day    date primary key,
  calls  integer not null default 1
);

alter table resolver_global_budget enable row level security;
-- No policies on purpose: service role only.

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
  -- Global daily ceiling first: cheaper to refuse before touching per-user
  -- state, and it bounds spend even across many fresh anonymous users.
  insert into resolver_global_budget as g (day, calls)
  values (current_date, 1)
  on conflict (day) do update set calls = g.calls + 1
  returning calls into v_global;
  if v_global > 50000 then
    return false;
  end if;

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
declare
  v_estimated_rows real;
begin
  -- F1: short keys only (mirrors MAX_CACHE_KEY_LENGTH in src/resolver).
  if p_key is null or length(p_key) < 1 or length(p_key) > 64 then return; end if;
  if p_intent not in ('food', 'exercise', 'weight', 'water', 'steps', 'sleep') then return; end if;
  if p_confidence is null or p_confidence < 0.6 or p_confidence > 1 then return; end if;

  -- F2 (server side): the same per-intent quantity caps the client validator
  -- enforces, so a poisoned row cannot smuggle an absurd quantity past the
  -- cache-hit path.
  if p_intent = 'sleep' then
    if p_qty is not null and (p_qty <= 0 or p_qty > 1440) then return; end if;
  elsif p_qty is null or p_qty <= 0 then
    return;
  elsif p_intent = 'food' and p_qty > 10000 then return;
  elsif p_intent = 'exercise' and p_qty > 1440 then return;
  elsif p_intent = 'weight' and (p_qty < 20 or p_qty > 300) then return;
  elsif p_intent = 'water' and p_qty > 20000 then return;
  elsif p_intent = 'steps' and p_qty > 100000 then return;
  end if;

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

  -- F1: row budget backstop. reltuples is autovacuum's estimate — cheap to
  -- read and precise enough for a runaway-growth circuit breaker.
  select coalesce(reltuples, 0) into v_estimated_rows
  from pg_class
  where oid = 'public.resolution_cache'::regclass;
  if v_estimated_rows >= 500000 then return; end if;

  insert into resolution_cache (normalized_text, intent, resolved_ref, qty, unit, confidence)
  values (p_key, p_intent, p_ref, p_qty, p_unit, p_confidence)
  on conflict (normalized_text) do update
    set hit_count = resolution_cache.hit_count + 1;
end;
$$;

revoke all on function public.resolver_cache_write(text, text, text, numeric, text, numeric)
  from public, anon, authenticated;
