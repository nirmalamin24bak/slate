-- Plan D5 — defend the global cache against prompt-injection poisoning.
--
-- resolver_cache_write validated that a ref EXISTS and quantities were sane,
-- but not that the ref was the CORRECT one for the phrase. A crafted line could
-- steer the model to emit a valid-but-wrong ref (map "chai" to a 900-kcal
-- dessert) that then serves every user typing that phrase from the GLOBAL
-- cache. Two new defenses:
--
--   1. N-distinct-user agreement. A model resolution no longer writes straight
--      to resolution_cache. It records an observation keyed by
--      (normalized_text, resolved_ref, user_id). A (phrase, ref) pair only
--      promotes to the live cache once CACHE_QUORUM distinct users have
--      independently produced it — one attacker's account cannot poison a key.
--
--   2. TTL. resolution_cache gains last_hit_at; the reaper evicts rows not hit
--      in 90 days so a stale or once-poisoned row cannot live forever.

alter table resolution_cache
  add column if not exists last_hit_at timestamptz not null default now();

-- Distinct (phrase, ref, user) observations awaiting quorum. No user_id RLS
-- concern: service-role only, and it holds normalized phrases (not raw text),
-- same privacy posture as resolution_cache.
create table resolution_cache_pending (
  normalized_text text not null,
  resolved_ref    text,
  intent          text not null,
  qty             numeric,
  unit            text,
  confidence      numeric not null,
  user_id         uuid not null,
  observed_at     timestamptz not null default now(),
  primary key (normalized_text, resolved_ref, user_id)
);

alter table resolution_cache_pending enable row level security;
-- No policies: service role only.

-- Drop the old 6-arg version (migration 0003); the new one adds p_user and is
-- a different signature, so the old would otherwise linger unused.
drop function if exists public.resolver_cache_write(text, text, text, numeric, text, numeric);

-- resolver_cache_write now takes the caller's uid and gates on quorum.
create or replace function public.resolver_cache_write(
  p_user text,
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
  v_distinct integer;
  v_quorum constant integer := 3;   -- distinct users who must agree
begin
  -- Same input validation as before (short key, intent whitelist, confidence
  -- floor, per-intent qty caps, ref existence).
  if p_key is null or length(p_key) < 1 or length(p_key) > 64 then return; end if;
  if p_intent not in ('food', 'exercise', 'weight', 'water', 'steps', 'sleep') then return; end if;
  if p_confidence is null or p_confidence < 0.6 or p_confidence > 1 then return; end if;

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

  -- Record this user's observation (idempotent per user+key+ref).
  insert into resolution_cache_pending
    (normalized_text, resolved_ref, intent, qty, unit, confidence, user_id)
  values (p_key, coalesce(p_ref, ''), p_intent, p_qty, p_unit, p_confidence, p_user::uuid)
  on conflict (normalized_text, resolved_ref, user_id) do update
    set observed_at = now(), qty = excluded.qty, unit = excluded.unit,
        confidence = excluded.confidence;

  -- Already live? Just bump its freshness and hit count.
  if exists (select 1 from resolution_cache where normalized_text = p_key) then
    update resolution_cache
      set hit_count = hit_count + 1, last_hit_at = now()
      where normalized_text = p_key;
    return;
  end if;

  -- Quorum check: distinct users who produced THIS (phrase, ref).
  select count(distinct user_id) into v_distinct
  from resolution_cache_pending
  where normalized_text = p_key and resolved_ref = coalesce(p_ref, '');
  if v_distinct < v_quorum then return; end if;

  -- Row-count backstop against runaway growth (unchanged intent).
  select coalesce(reltuples, 0) into v_estimated_rows
  from pg_class where oid = 'public.resolution_cache'::regclass;
  if v_estimated_rows >= 500000 then return; end if;

  -- Promote to the live cache.
  insert into resolution_cache
    (normalized_text, intent, resolved_ref, qty, unit, confidence, last_hit_at)
  values (p_key, p_intent, p_ref, p_qty, p_unit, p_confidence, now())
  on conflict (normalized_text) do update
    set hit_count = resolution_cache.hit_count + 1, last_hit_at = now();
end;
$$;

revoke all on function public.resolver_cache_write(text, text, text, text, numeric, text, numeric)
  from public, anon, authenticated;

-- Extend the reaper: evict stale cache rows and old pending observations.
create or replace function public.reap_resolver_state()
returns void
language sql
security definer
set search_path = public
as $$
  delete from resolver_rate_limits where window_start < now() - interval '1 day';
  delete from resolver_global_budget where day < current_date - 7;
  -- TTL: a cache row not hit in 90 days lapses (recovers from poisoning).
  delete from resolution_cache where last_hit_at < now() - interval '90 days';
  -- Pending observations that never reached quorum in 30 days are noise.
  delete from resolution_cache_pending where observed_at < now() - interval '30 days';
$$;
