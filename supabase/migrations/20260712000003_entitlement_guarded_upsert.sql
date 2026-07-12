-- Security M1/M4 + data: make the RevenueCat webhook upsert replay-safe and
-- order-safe.
--
-- The webhook (revenuecat-webhook) previously upserted entitlements by user_id
-- with no guard: it never checked event.id (so a captured event could be
-- replayed to re-grant or re-revoke Plus), and it had no ordering guard (so an
-- out-of-order or delayed EXPIRATION arriving after a RENEWAL could flip
-- active=false over a newer grant). With auth being static-bearer-only on that
-- endpoint (M1), replay is the sharpest edge.
--
-- We store the RC event_timestamp_ms of the event that produced the current row
-- and reject any incoming event that is (a) the same event.id we already
-- applied, or (b) older than the applied event. Because RevenueCat can deliver
-- events out of order, event timestamp — not arrival time — is the correct
-- ordering key. TRANSFER's per-source revokes go through the same guard.
--
-- Done as a SECURITY DEFINER RPC so the compare-and-set is atomic in one
-- statement (no read-then-write TOCTOU in the Edge Function), and revoked from
-- anon/authenticated so only the service role (which the webhook uses) can call
-- it. The service role bypasses RLS anyway; the revoke closes the definer
-- surface, matching every other definer function in this schema.

alter table entitlements
  add column if not exists event_ts_ms bigint;  -- RC event_timestamp_ms of applied event

create or replace function public.apply_entitlement_event(
  p_user_id     uuid,
  p_active      boolean,
  p_expires_at  timestamptz,
  p_environment text,
  p_event_type  text,
  p_event_id    text,
  p_event_ts_ms bigint
)
returns text  -- 'applied' | 'duplicate' | 'stale'
language plpgsql
security definer
set search_path = public
as $$
declare
  existing entitlements%rowtype;
begin
  select * into existing from entitlements where user_id = p_user_id;

  if found then
    -- Exact replay of an event we already applied: no-op, report duplicate.
    if existing.event_id is not null and existing.event_id = p_event_id then
      return 'duplicate';
    end if;
    -- Out-of-order older event: keep the newer state. Only guards when both
    -- sides carry a timestamp; a null on either side falls through to apply
    -- (first write, or an event RC sent without a usable timestamp).
    if existing.event_ts_ms is not null
       and p_event_ts_ms is not null
       and p_event_ts_ms < existing.event_ts_ms then
      return 'stale';
    end if;
  end if;

  insert into entitlements
    (user_id, product, active, expires_at, environment, last_event, event_id, event_ts_ms, updated_at)
  values
    (p_user_id, 'plus', p_active, p_expires_at, p_environment, p_event_type, p_event_id, p_event_ts_ms, now())
  on conflict (user_id) do update
    set active      = excluded.active,
        expires_at  = excluded.expires_at,
        environment = excluded.environment,
        last_event  = excluded.last_event,
        event_id    = excluded.event_id,
        event_ts_ms = excluded.event_ts_ms,
        updated_at  = now();

  return 'applied';
end;
$$;

revoke all on function public.apply_entitlement_event(uuid, boolean, timestamptz, text, text, text, bigint)
  from public, anon, authenticated;
