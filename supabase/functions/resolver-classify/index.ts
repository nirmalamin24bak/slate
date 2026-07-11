// resolver-classify — the only server hop in the resolver pipeline (spec/05
// step 3 + step 6). One journal line in, the raw model reply out. Security
// posture (plan, standing):
//   * JWT required: the gateway verifies it, and we still resolve the user
//     via auth.getUser() — no user, no model call.
//   * zod-validated input with a hard length cap. The line is the only thing
//     a client controls; nothing else in the request reaches the model.
//   * per-user rate limit via an atomic RPC (30 calls/min).
//   * the model is untrusted BOTH ways: its reply is returned verbatim for
//     the client to validate against its catalogue, and the global cache
//     write happens here — service role only — through a SQL function that
//     re-validates refs against the reference tables. Clients can never
//     write resolution_cache; there is no separate cache-write endpoint to
//     poison.
//   * raw_text stays inside this hop: it goes to the model provider (a DPDP
//     processor) and into no log or analytics event.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

import { buildSystemPrompt } from './prompt.ts';
import type { Catalogue } from './prompt.ts';
import { providerFromEnv } from './providers.ts';

const RATE_LIMIT_PER_MINUTE = 30;
const MODEL_TIMEOUT_MS = 2500; // p95 budget is 1200ms; this is the hard stop

// Kill switch (plan A5). Set RESOLVER_DISABLED=1 in the function's secrets to
// stop all model calls without a redeploy — a provider outage, a cost spike,
// or a bad model. Clients degrade to cache + local rules and honest-unresolved
// (503 is treated as non-retryable by the transport, so the queue does not
// hammer a deliberately-disabled resolver).
function resolverDisabled(): boolean {
  return Deno.env.get('RESOLVER_DISABLED') === '1';
}
const CATALOGUE_TTL_MS = 5 * 60 * 1000;
const CONFIDENCE_FLOOR = 0.6;

const BodySchema = z.object({
  line: z.string().trim().min(1).max(200),
});

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

const service = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

// Mirrors src/resolver/context.ts — the cache-consistency rule ("only cache
// what a token scan can reconstruct") must hold on the writing side.
const OUTSIDE_TOKENS = new Set([
  'swiggy',
  'zomato',
  'ordered',
  'outside',
  'hotel',
  'restaurant',
  'canteen',
  'bahar',
  'dhaba',
]);

function contextOf(line: string): 'home' | 'outside' {
  for (const word of line.split(' ')) if (OUTSIDE_TOKENS.has(word)) return 'outside';
  return 'home';
}

// Security review F4: clients always send normalize() output, but nothing
// stops a direct invocation sending raw text ("ordered,dal") whose token
// split differs from what a reading client will compute — which would cache
// a wrong-context row globally. Rather than duplicate the full client
// normalizer here (drift), refuse to CACHE any line that is not already in
// canonical shape. Classification itself still proceeds.
function isCanonical(line: string): boolean {
  const light = line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return light === line;
}

let catalogueCache: { at: number; prompt: string } | null = null;

async function systemPrompt(): Promise<string> {
  if (catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_TTL_MS) {
    return catalogueCache.prompt;
  }
  const [dishes, exercises, packaged] = await Promise.all([
    service.from('dishes').select('id,name,aliases,default_unit,default_qty').limit(2000),
    service.from('exercises').select('id,name,aliases,unit').limit(500),
    service.from('packaged_foods').select('barcode,brand,name').limit(2000),
  ]);
  if (dishes.error || exercises.error || packaged.error) {
    throw new Error('catalogue load failed');
  }
  const catalogue: Catalogue = {
    dishes: dishes.data,
    exercises: exercises.data,
    packagedFoods: packaged.data,
  };
  catalogueCache = { at: Date.now(), prompt: buildSystemPrompt(catalogue) };
  return catalogueCache.prompt;
}

/**
 * Best-effort global cache write (spec/04). Only a single, confident,
 * context-reconstructible resolution may become a cache row; the SQL function
 * re-validates refs against the reference tables (and rejects custom-dish
 * refs — the cache is global). Failures are swallowed: the cache is an
 * optimisation, never the answer.
 */
async function maybeCacheWrite(line: string, reply: string): Promise<void> {
  // F1/F4: only short, canonical keys may enter the global cache. The SQL
  // function re-checks the length; this just saves the round trip.
  if (line.length > 64 || !isCanonical(line)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
  const r = parsed as Record<string, unknown>;
  if (typeof r.intent !== 'string' || typeof r.confidence !== 'number') return;
  if (r.confidence < CONFIDENCE_FLOOR) return;
  const context = r.context === 'outside' ? 'outside' : 'home';
  if (contextOf(line) !== context) return;

  await service.rpc('resolver_cache_write', {
    p_key: line,
    p_intent: r.intent,
    p_ref: typeof r.ref === 'string' ? r.ref : null,
    p_qty: typeof r.qty === 'number' ? r.qty : null,
    p_unit: typeof r.unit === 'string' ? r.unit : null,
    p_confidence: r.confidence,
  });
}

/**
 * Server-authoritative Plus check (plan B2): active AND not expired. Read with
 * the service role so it cannot be spoofed by the caller. Defaults to false on
 * any error — Plus is a grant, never assumed.
 */
async function callerIsPlus(userId: string): Promise<boolean> {
  const { data } = await service
    .from('entitlements')
    .select('active, expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.active) return false;
  return data.expires_at === null || new Date(data.expires_at as string) > new Date();
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  // Resolve the caller. The gateway already verified the JWT; getUser() gives
  // us the uid for rate limiting and rejects anything else.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'unauthorized' });

  // Server-authoritative Plus (plan B2). A spoofed client flag grants nothing
  // that costs money: this reads the entitlements table with the service role
  // and is the only source of truth for Plus-gated resolution. Custom-dish
  // refs (Phase 5) will only be offered to the model / accepted when isPlus.
  const isPlus = await callerIsPlus(userData.user.id);
  void isPlus; // Phase 5 threads this into systemPrompt(catalogue, { isPlus }).

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return json(400, { error: 'invalid input' });
  }

  // Kill switch before any spend: refuse cheaply, before the rate RPC and the
  // model call. Clients treat 503 as a signal to fall back, not to retry.
  if (resolverDisabled()) return json(503, { error: 'resolver disabled' });

  const { data: allowed, error: rateError } = await service.rpc('resolver_rate_check', {
    p_user: userData.user.id,
    p_limit: RATE_LIMIT_PER_MINUTE,
    p_window_seconds: 60,
  });
  if (rateError) return json(500, { error: 'rate check failed' });
  if (!allowed) return json(429, { error: 'rate limited' });

  try {
    const system = await systemPrompt();
    const provider = providerFromEnv();
    const reply = await provider.complete(system, body.line, AbortSignal.timeout(MODEL_TIMEOUT_MS));

    // Fire-and-forget would risk the isolate freezing before the write lands;
    // await it, but never let it fail the request.
    await maybeCacheWrite(body.line, reply).catch(() => undefined);

    return json(200, { reply });
  } catch (error) {
    const status = error instanceof DOMException && error.name === 'TimeoutError' ? 504 : 502;
    return json(status, { error: 'classify failed' });
  }
});
