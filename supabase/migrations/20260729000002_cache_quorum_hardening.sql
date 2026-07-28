-- Audit C2 — make the cache-poisoning quorum cost something.
--
-- Migration ...0011 defends the global cache with "3 distinct users must
-- independently produce this (phrase, ref) before it goes live". That defence
-- assumes accounts are scarce. In Slate an account is one signInAnonymously()
-- call: free, instant, unlimited, by design (there is no login). So the quorum
-- costs an attacker three HTTP requests.
--
-- The payoff is the whole product. A crafted line that steers the model to a
-- valid-but-wrong catalogue ref ("chai" -> a 900 kcal dessert id) promotes to
-- resolution_cache and is then served to EVERY user who types that phrase, with
-- no model call and no second opinion. It is self-perpetuating: eviction is by
-- last_hit_at, and being served refreshes it (resolver_cache_touch), so a
-- popular poisoned key never reaches the 90-day TTL. CLAUDE.md guardrail 3 says
-- a hallucinated number is a bug, not an estimate; this is that bug, made
-- persistent and shared.
--
-- Four changes, all on the promotion gate. None of them can break a resolve:
-- refusing to promote just means the next caller pays for a model call, which is
-- always correct.
--
--   1. QUORUM 3 -> 5.  Linear cost, but the cheapest lever and it composes with
--      the rest.
--
--   2. ACCOUNT AGE.  Only observations from users whose auth.users row is older
--      than 24h count toward quorum. Sybils are still free but no longer
--      instant, and an attack now has to be planned a day ahead of being run.
--
--   3. TEMPORAL SPREAD.  The counted observations must span at least an hour.
--      Five accounts firing the same crafted line in one burst is the shape of
--      the attack; five real users typing "2 roti" over a morning is the shape of
--      the truth.
--
--   4. NO CONTESTED PHRASES.  If distinct refs have been observed for the same
--      phrase, promote NEITHER. Disagreement is the signal that something is
--      being steered — and a phrase real users agree on is exactly the phrase
--      worth caching. This one is close to free and hard to route around: the
--      attacker cannot suppress the honest observations.
--
-- Considered and rejected: requiring the phrase to share a token with the dish
-- name or its aliases. It would reject "bhaat" -> rice, which is precisely the
-- Hinglish mapping the resolver exists to do (spec/05), and the cost of a false
-- rejection is a permanently uncacheable common phrase.
--
-- Not solved here: an attacker who prepares aged accounts and paces them. That
-- needs a signal this schema does not have (device, IP, payment). The mitigation
-- is detection — see the quarantine view at the bottom, which is what an alert
-- should watch once observability exists (audit C8).

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
  v_distinct       integer;
  v_spread         interval;
  v_competing      integer;
  v_quorum         constant integer  := 5;
  v_min_age        constant interval := interval '24 hours';
  v_min_spread     constant interval := interval '1 hour';
begin
  -- Input validation, unchanged from ...0011: short key, intent whitelist,
  -- confidence floor, per-intent qty caps, ref must exist in a GLOBAL reference
  -- table (custom_dishes refs are rejected — the cache is shared).
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

  -- Record this user's observation (idempotent per user+key+ref). Every
  -- observation is recorded, including from brand-new accounts: they simply do
  -- not COUNT toward quorum until the account ages past v_min_age, at which
  -- point an honest user's early observation legitimately starts counting.
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

  -- (4) Contested phrase: distinct refs seen for this key, counting only
  -- observations that are themselves eligible. Promote neither.
  select count(distinct pend.resolved_ref) into v_competing
  from resolution_cache_pending pend
  join auth.users u on u.id = pend.user_id
  where pend.normalized_text = p_key
    and u.created_at < now() - v_min_age;
  if v_competing > 1 then return; end if;

  -- (1)(2)(3) Quorum over aged accounts, with a spread requirement.
  select count(distinct pend.user_id),
         coalesce(max(pend.observed_at) - min(pend.observed_at), interval '0')
    into v_distinct, v_spread
  from resolution_cache_pending pend
  join auth.users u on u.id = pend.user_id
  where pend.normalized_text = p_key
    and pend.resolved_ref = coalesce(p_ref, '')
    and u.created_at < now() - v_min_age;

  if v_distinct < v_quorum then return; end if;
  if v_spread < v_min_spread then return; end if;

  -- Row-count backstop against runaway growth (unchanged intent).
  select coalesce(reltuples, 0) into v_estimated_rows
  from pg_class where oid = 'public.resolution_cache'::regclass;
  if v_estimated_rows >= 500000 then return; end if;

  insert into resolution_cache
    (normalized_text, intent, resolved_ref, qty, unit, confidence, last_hit_at)
  values (p_key, p_intent, p_ref, p_qty, p_unit, p_confidence, now())
  on conflict (normalized_text) do update
    set hit_count = resolution_cache.hit_count + 1, last_hit_at = now();
end;
$$;

revoke all on function public.resolver_cache_write(text, text, text, text, numeric, text, numeric)
  from public, anon, authenticated;

-- What an alert should watch (audit C8): phrases where the pending table holds
-- disagreement. On an honest corpus this is near-empty and made of genuine
-- ambiguity; under a steering attack it is where the attack shows up first,
-- because rule (4) parks the contested phrase here instead of promoting it.
--
-- A view, not a table: it is a diagnostic read, and there is nothing to keep in
-- sync. Service-role only, like everything else here — views run with the
-- privileges of the querying role, and resolution_cache_pending denies all.
create or replace view public.resolver_contested_phrases as
  select normalized_text,
         count(distinct resolved_ref)                as competing_refs,
         count(distinct user_id)                     as observers,
         min(observed_at)                            as first_seen,
         max(observed_at)                            as last_seen
  from resolution_cache_pending
  group by normalized_text
  having count(distinct resolved_ref) > 1;

revoke all on public.resolver_contested_phrases from anon, authenticated;

-- The quorum query filters pending rows by phrase and joins auth.users; the
-- primary key leads with normalized_text so the lookup is covered, but the
-- observed_at spread and the user join both read every row for the phrase.
-- Small per phrase, and this keeps it that way as the table grows.
create index if not exists resolution_cache_pending_key_idx
  on resolution_cache_pending (normalized_text, resolved_ref);
