// revenuecat-webhook — RevenueCat's server tells us the truth about Plus
// (plan B2). Called by RevenueCat, NOT by a Slate client, so it authenticates
// with a shared secret in the Authorization header (configured in the RC
// dashboard), not a Supabase JWT. Deploy with verify_jwt = false
// (supabase/config.toml) or the gateway rejects every event.
//
// It maps the RC app_user_id (= auth.uid(), via Purchases.logIn aliasing) to a
// row in the entitlements table with the service role. The authoritative Plus
// check everywhere is `active AND (expires_at IS NULL OR expires_at > now())`,
// so a missed EXPIRATION still lapses the row on time.
//
// Every write goes through apply_entitlement_event (migration ...0003), which
// atomically dedupes exact event.id replays and rejects events older than the
// one already applied (RC can deliver out of order — event timestamp, not
// arrival, is the ordering key). This blunts a replay of a captured event
// (M1/M4): re-sending a grant is a no-op, and a stale revoke can't clobber a
// newer grant. The bearer secret is still the only sender authentication —
// rotate REVENUECAT_WEBHOOK_SECRET on any suspicion of exposure (runbook:
// docs/breach-playbook.md); a full HMAC body signature is the follow-up when
// RC's signing secret is provisioned.

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')!;
const ENTITLEMENT_ID = 'plus';

const service = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Constant-time string compare — no early-exit timing oracle on the secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Which RC events grant vs revoke. CANCELLATION keeps access until expiry
// (auto-renew off, not access off); EXPIRATION is where access actually ends.
function activeFor(eventType: string): boolean | 'keep' {
  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
    case 'NON_RENEWING_PURCHASE':
    case 'SUBSCRIPTION_EXTENDED':
    case 'CANCELLATION': // access continues to expires_at
      return true;
    case 'EXPIRATION':
    case 'SUBSCRIPTION_PAUSED':
      return false;
    default:
      return 'keep'; // BILLING_ISSUE and anything unknown: don't flip
  }
}

interface RcEvent {
  type: string;
  id?: string;
  app_user_id?: string;
  entitlement_ids?: string[];
  entitlement_id?: string;
  expiration_at_ms?: number;
  event_timestamp_ms?: number;
  environment?: string;
  transferred_from?: string[];
}

// Apply one grant/revoke through the guarded RPC (migration ...0003): it dedupes
// exact event.id replays and rejects events older than the one already applied,
// atomically. Returns true on success (including idempotent 'duplicate'/'stale'
// no-ops — those are not failures, so we still 200 and RC stops retrying).
async function upsertEntitlement(userId: string, active: boolean, e: RcEvent): Promise<boolean> {
  const { error } = await service.rpc('apply_entitlement_event', {
    p_user_id: userId,
    p_active: active,
    p_expires_at: e.expiration_at_ms ? new Date(e.expiration_at_ms).toISOString() : null,
    p_environment: e.environment ?? null,
    p_event_type: e.type,
    p_event_id: e.id ?? null,
    p_event_ts_ms: e.event_timestamp_ms ?? null,
  });
  return !error;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const auth = req.headers.get('Authorization') ?? '';
  if (!timingSafeEqual(auth, webhookSecret)) return json(401, { error: 'unauthorized' });

  let e: RcEvent;
  try {
    const body = await req.json();
    e = body?.event;
  } catch {
    return json(400, { error: 'invalid body' });
  }
  // Anything unactionable returns 200 so RC does not retry-storm: TEST pings,
  // events before logIn (app_user_id is RC's own anon id, not a uuid we can map).
  if (!e || e.type === 'TEST') return json(200, { ok: true });
  const userId = e.app_user_id ?? '';
  if (!UUID_RE.test(userId)) return json(200, { ok: true });

  // TRANSFER moves the entitlement between app_user_ids; revoke the sources.
  if (e.type === 'TRANSFER') {
    for (const from of e.transferred_from ?? []) {
      if (UUID_RE.test(from)) await upsertEntitlement(from, false, e);
    }
    const ok = await upsertEntitlement(userId, true, e);
    return ok ? json(200, { ok: true }) : json(500, { error: 'upsert failed' });
  }

  const grantsPlus =
    (e.entitlement_ids ?? []).includes(ENTITLEMENT_ID) || e.entitlement_id === ENTITLEMENT_ID;
  const target = activeFor(e.type);
  if (target === 'keep') return json(200, { ok: true }); // don't flip on ambiguous events

  const ok = await upsertEntitlement(userId, grantsPlus ? target : false, e);
  return ok ? json(200, { ok: true }) : json(500, { error: 'upsert failed' });
});
