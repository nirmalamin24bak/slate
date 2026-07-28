// entitlement-refresh — the reconciliation path for a lost/delayed webhook
// (plan B2). The client calls this (JWT-verified) when the RC SDK says Plus but
// the server row says free, or after restorePurchases. The function asks
// RevenueCat's REST API directly for the caller's authoritative subscriber
// state and upserts the entitlements row — the server never trusts the client's
// claim, it verifies with RC itself.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { log } from '../_shared/log.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const rcSecretKey = Deno.env.get('REVENUECAT_SECRET_API_KEY')!;
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

interface RcSubscriber {
  subscriber?: {
    entitlements?: Record<string, { expires_date: string | null }>;
  };
}

Deno.serve(async (req) => {
  // Audit C8. This is the reconciliation path a user reaches when the app says
  // free and they have paid, so its failures are support tickets by another
  // name — and 'revenuecat unreachable' in particular is an outage of someone
  // else's service that nobody here would otherwise notice.
  const startedAt = Date.now();
  const done = (
    status: number,
    body: unknown,
    fields: { outcome: string; user?: string; plus?: boolean },
  ) => {
    log('entitlement-refresh', status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', {
      ...fields,
      status,
      ms: Date.now() - startedAt,
    });
    return json(status, body);
  };

  if (req.method !== 'POST') {
    return done(405, { error: 'method not allowed' }, { outcome: 'method_not_allowed' });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) {
    return done(401, { error: 'unauthorized' }, { outcome: 'unauthorized' });
  }
  const userId = userData.user.id;

  // M2: per-user cooldown before the outbound RC call, so an authenticated
  // caller can't loop this endpoint into unbounded RevenueCat REST traffic
  // under Slate's secret key. 30s covers the honest cases (SDK/server
  // disagreement, post-restore); a tighter loop gets 429 and backs off.
  const { data: allowed, error: rateError } = await service.rpc('entitlement_refresh_check', {
    p_user: userId,
    p_cooldown_seconds: 30,
  });
  if (rateError) {
    return done(
      500,
      { error: 'rate check failed' },
      { outcome: 'rate_check_failed', user: userId },
    );
  }
  if (allowed === false) {
    return done(429, { error: 'slow down' }, { outcome: 'cooldown', user: userId });
  }

  // Ask RevenueCat for this subscriber's authoritative state.
  let sub: RcSubscriber;
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${userId}`, {
      headers: { Authorization: `Bearer ${rcSecretKey}` },
    });
    if (!res.ok) {
      return done(
        502,
        { error: 'revenuecat unreachable' },
        { outcome: 'rc_http_error', user: userId },
      );
    }
    sub = await res.json();
  } catch {
    return done(
      502,
      { error: 'revenuecat unreachable' },
      { outcome: 'rc_unreachable', user: userId },
    );
  }

  const ent = sub.subscriber?.entitlements?.[ENTITLEMENT_ID];
  const expiresAt = ent?.expires_date ?? null;
  // Active if the entitlement exists and hasn't expired (null = lifetime).
  const active = !!ent && (expiresAt === null || new Date(expiresAt) > new Date());

  // Audit M1: this used to be a raw `.upsert()`, which meant entitlements had two
  // write paths with different guarantees. The webhook writes through
  // apply_entitlement_event (migration ...0003), which orders by RC event
  // timestamp and dedupes by event id; the raw upsert honoured neither, and its
  // column list omitted event_id / event_ts_ms — so a refresh left the row
  // describing its own state under the PREVIOUS event's ordering key, and the
  // next webhook event was judged stale-or-not against a timestamp that no
  // longer matched the row.
  //
  // Both paths now go through the same RPC. A refresh is authoritative (we just
  // asked RevenueCat directly), so it carries `now()` as its ordering timestamp
  // and wins over anything older, and a null event id means it can never be
  // mistaken for a replay of a real RC event.
  //
  // The RPC assigns `environment` unconditionally, and RC's REST subscriber
  // payload does not carry one — so we re-send what the webhook last recorded
  // rather than blanking an audit field. A benign race on this one column is
  // acceptable: nothing reads `environment` to make an access decision.
  const { data: existing } = await service
    .from('entitlements')
    .select('environment')
    .eq('user_id', userId)
    .maybeSingle();

  const { error } = await service.rpc('apply_entitlement_event', {
    p_user_id: userId,
    p_active: active,
    p_expires_at: expiresAt,
    p_environment: (existing?.environment as string | null) ?? null,
    p_event_type: 'refresh',
    p_event_id: null,
    p_event_ts_ms: Date.now(),
  });
  if (error) {
    return done(
      500,
      { error: 'upsert failed' },
      { outcome: 'upsert_failed', user: userId, plus: active },
    );
  }

  return done(200, { plus: active }, { outcome: 'ok', user: userId, plus: active });
});
