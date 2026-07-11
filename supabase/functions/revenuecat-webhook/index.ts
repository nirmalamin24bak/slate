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
  environment?: string;
  transferred_from?: string[];
}

async function upsertEntitlement(userId: string, active: boolean, e: RcEvent): Promise<boolean> {
  const { error } = await service.from('entitlements').upsert(
    {
      user_id: userId,
      product: ENTITLEMENT_ID,
      active,
      expires_at: e.expiration_at_ms ? new Date(e.expiration_at_ms).toISOString() : null,
      environment: e.environment ?? null,
      last_event: e.type,
      event_id: e.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
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
