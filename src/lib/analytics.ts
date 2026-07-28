// PostHog boundary — the only file in the app that may touch the PostHog SDK.
//
// The contract is docs/analytics-handoff.md, which traces to spec/08. The two
// rules that shape this file:
//
// 1. `raw_text` never leaves the device. Not truncated, not hashed, not "for
//    debugging". Enforced by construction: there is no exported
//    capture(name, props). Call sites pass a value of AnalyticsEvent, a closed
//    union, so a payload field that could hold entry text cannot be added
//    without editing this file — where the rule is written down.
// 2. Autocapture and session recording stay off permanently. They would
//    exfiltrate the journal wholesale. Off in code, not as a dashboard setting
//    someone can flip: this module never mounts PostHogProvider (RN autocapture
//    only exists through it) and passes the replay flags off explicitly.
//
// Identity is auth.uid() and nothing else — no name, email, age, sex, height or
// weight. Same id RevenueCat is aliased to (revenuecat.ts), so purchases and
// product events line up without a second identifier.
//
// Inert unless BOTH EXPO_PUBLIC_POSTHOG_API_KEY and _HOST are set; env.ts throws
// if only one is, because a key with a default host ships events to PostHog US
// Cloud and breaks data residency. The SDK itself is loaded guardedly like
// react-native-purchases: absent in vitest, on web, and in Expo Go, and its
// absence means "no analytics", not a crash.

import type { Intent } from '../resolver/types';

import { env } from './env';
import type { PlusPlan } from './revenuecat';

/** Routes under app/. Kept a closed union so a screen name cannot be free text. */
export type Screen =
  | 'journal'
  | 'history'
  | 'stats'
  | 'streak'
  | 'paywall'
  | 'scanner'
  | 'chat'
  | 'settings'
  | 'onboarding';

/**
 * Route path to Screen. Returns null for anything unrecognised, so a route added
 * later is silently not tracked rather than sent as a raw path string — a path
 * can carry query params, and a query param can carry anything.
 *
 * Settings collapses to one value on purpose: which settings sub-page someone
 * opened is not a number Slate needs, and `/settings/saved-foods` would leak
 * more about a user's session than `screen_viewed` is worth.
 */
export function screenOf(pathname: string): Screen | null {
  const path = (pathname.split('?')[0] ?? '').replace(/\/+$/, '');
  if (path === '' || path === '/index') return 'journal';
  if (path.startsWith('/settings')) return 'settings';
  const rest = path.slice(1);
  const known: readonly Screen[] = [
    'history',
    'stats',
    'streak',
    'paywall',
    'scanner',
    'chat',
    'onboarding',
  ];
  return known.find((s) => s === rest) ?? null;
}

/**
 * Confidence is bucketed, never sent raw. A float is a fingerprint: paired with
 * a timestamp it narrows down which line was typed. Thresholds match the
 * resolver's own low-confidence handling (spec/05).
 */
export type ConfidenceBucket = 'high' | 'medium' | 'low';

export function confidenceBucket(confidence: number): ConfidenceBucket {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

/** Where the user was when the paywall opened. One per router.push('/paywall'). */
export type PaywallGate = 'history_depth' | 'settings';

/**
 * Why anonymous sign-in did not complete. The Supabase error *message* used to
 * be sent verbatim; it can carry a project ref, a request id, or a rate-limit
 * detail, none of which belong in analytics. Classified into a fixed set here.
 */
export type SigninDeferral = 'offline' | 'rate_limited' | 'rejected' | 'unknown';

export function signinDeferral(message: string): SigninDeferral {
  const m = message.toLowerCase();
  if (/network|fetch|offline|timeout|connection/.test(m)) return 'offline';
  if (/rate|too many|429/.test(m)) return 'rate_limited';
  if (/disabled|forbidden|unauthor|reject|signups? not allowed/.test(m)) return 'rejected';
  return 'unknown';
}

/**
 * Every event Slate may send, and every property it may carry. Adding a case is
 * a deliberate act reviewed against spec/08 — which is the point.
 *
 * Deliberately absent: anything derived from what the user typed. `raw_text`,
 * normalized text, nicknames, dish names, entry ids. `entry_unresolved` carries
 * the *length* of the normalized text so `unresolved_rate` can be split by
 * short-vs-long input without the input itself.
 */
export type AnalyticsEvent =
  // --- product (docs/analytics-handoff.md, week-8 dashboard) ---
  | {
      name: 'entry_resolved';
      intent: Intent;
      /** Catalogue id (dish/exercise/barcode) — ours, not the user's words. */
      ref: string | null;
      confidence_bucket: ConfidenceBucket;
      /**
       * Wall time for the whole resolve() call. A line that splits into several
       * segments reports the same figure on each, so p95 is per-line latency —
       * which is what the user feels — not per-segment.
       */
      resolve_ms: number;
      /**
       * Which stage answered. The cost signal: spec/05 puts the cache hit rate
       * above 90%, and 'model' is the only value that spends money.
       */
      source: 'cache' | 'rules' | 'model';
    }
  | { name: 'entry_unresolved'; normalized_len: number }
  | { name: 'screen_viewed'; screen: Screen }
  | { name: 'paywall_viewed'; gate: PaywallGate }
  | { name: 'purchase_completed'; plan: PlusPlan }
  | { name: 'export_run' }
  | { name: 'delete_run' }
  // --- reliability ---
  | { name: 'resolver_retry_exhausted' }
  | { name: 'anon_signin_deferred'; reason: SigninDeferral }
  | { name: 'sync_failed'; consecutive: number };

// --- minimal typed surface of posthog-react-native ---------------------------

interface PostHogClient {
  capture(event: string, properties?: Record<string, unknown>): void;
  identify(distinctId: string, properties?: Record<string, unknown>): void;
  optOut(): void;
  flush(): Promise<void> | void;
}

interface PostHogModule {
  PostHog: new (apiKey: string, options: Record<string, unknown>) => PostHogClient;
}

function requireSdk(): PostHogModule | null {
  try {
    // Not a dependency yet: installing it is gated on the self-hosted host
    // existing and on counsel signing the DPDP processor terms (launch-gate
    // 2.1). Until then this throws and analytics stays inert — the same
    // guarded-require shape as revenuecat.ts, so wiring it later is one
    // `npm i` and no code change here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('posthog-react-native') as PostHogModule;
  } catch {
    return null;
  }
}

// --- state -------------------------------------------------------------------

// Indirection so a test can supply the module and assert the options we pass to
// the constructor. Those options ARE the compliance guarantee — host pins the
// region, the replay flags keep the journal off a vendor's disk — so they need a
// test, and the package is not installed yet.
let loadSdk: () => PostHogModule | null = requireSdk;

let client: PostHogClient | null = null;
let configured = false;

/**
 * Events captured before configureAnalytics resolves. Boot fires
 * `screen_viewed` and can fire `anon_signin_deferred` before the session id
 * that identify() needs exists, and those are exactly the events that describe
 * a bad first launch. Bounded, because an unconfigured build (no key) must not
 * grow a list for the life of the process.
 */
const pending: AnalyticsEvent[] = [];
export const MAX_PENDING_EVENTS = 32;

function propertiesOf(event: AnalyticsEvent): Record<string, unknown> | undefined {
  const { name, ...rest } = event;
  void name;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function send(event: AnalyticsEvent): void {
  if (!client) return;
  try {
    client.capture(event.name, propertiesOf(event));
  } catch {
    // Analytics must never break the journal. A failed capture is not an error
    // worth reporting — reportError would route back through here on a bad day.
  }
}

/**
 * Boot-time wiring. Safe to call when the SDK is absent or no key is set (both
 * no-ops), and safe to call repeatedly (configures once).
 *
 * @param userId auth.uid(). The only trait sent, ever.
 */
export function configureAnalytics(userId: string): void {
  if (configured) return;
  configured = true;
  const config = env.postHog; // throws if half-configured — see env.ts
  const sdk = config ? loadSdk() : null;
  if (!config || !sdk) {
    // Intentionally off, or running where the native module cannot exist.
    // Drop what queued rather than holding a user's session in memory.
    pending.length = 0;
    return;
  }
  try {
    client = new sdk.PostHog(config.key, {
      // Self-hosted ap-south-1. env.ts guarantees this is present.
      host: config.host,
      // Off, permanently. See the header and docs/analytics-handoff.md.
      enableSessionReplay: false,
      captureNativeAppLifecycleEvents: false,
      // No $screen autocapture, no touch autocapture: this module never mounts
      // PostHogProvider, which is the only way RN autocapture is enabled.
      disableGeoip: true,
    });
    // No traits. Not age, not sex, not height, not weight (spec/08).
    client.identify(userId);
  } catch {
    client = null;
    pending.length = 0;
    return;
  }
  for (const event of pending) send(event);
  pending.length = 0;
}

/**
 * Record one event. The only capture path in the app.
 *
 * There is no string-name overload on purpose: `capture(name, props)` is how
 * `raw_text` reaches a vendor by accident, and the handoff doc calls a call
 * site that can pass an arbitrary string a failure of the boundary.
 */
export function track(event: AnalyticsEvent): void {
  if (client) {
    send(event);
    return;
  }
  if (configured) return; // no key, or SDK absent: nothing will ever flush
  if (pending.length >= MAX_PENDING_EVENTS) return;
  pending.push(event);
}

/** Best-effort flush before the app backgrounds or the user deletes their data. */
export async function flushAnalytics(): Promise<void> {
  if (!client) return;
  try {
    await client.flush();
  } catch {
    /* offline; the SDK retries on its own */
  }
}

/**
 * Stop sending. Called by the delete-my-data flow (spec/08 §2) so the last
 * thing that happens is not an event about the user who just left.
 */
export function stopAnalytics(): void {
  pending.length = 0;
  const c = client;
  client = null;
  if (!c) return;
  try {
    c.optOut();
  } catch {
    /* nothing to do */
  }
}

/** Test seam. Replaces the SDK client so the boundary is testable with no SDK. */
export function __setClientForTest(next: PostHogClient | null, isConfigured = true): void {
  client = next;
  configured = isConfigured;
  pending.length = 0;
}

/** Test seam. Supplies the module configureAnalytics would have required. */
export function __setSdkLoaderForTest(loader: (() => PostHogModule | null) | null): void {
  loadSdk = loader ?? requireSdk;
}

/** Test seam. Back to a cold module: nothing configured, nothing queued. */
export function __resetForTest(): void {
  client = null;
  configured = false;
  pending.length = 0;
  loadSdk = requireSdk;
}

/** Test seam. Number of events waiting for configureAnalytics. */
export function __pendingCountForTest(): number {
  return pending.length;
}

export type { PostHogClient as __PostHogClientForTest };
