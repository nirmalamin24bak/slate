// Central error sink. Every swallowed catch and the root error boundary route
// through here so there is one place crash reporting is wired.
//
// Product analytics is NOT here — it lives in analytics.ts behind a closed event
// union, because spec/08 forbids `raw_text` reaching a vendor and a
// `report(name: string, props)` signature is how that happens by accident. The
// free-form reportEvent that used to sit in this file was already carrying a
// Supabase error message and a journal entry id into a would-be PostHog payload.
//
// Audit C8: this was a dev-only console sink with a `TODO(C1)` where Sentry
// goes, so in a release build nothing reported anything, ever. It is now a real
// boundary. Sentry is inert until EXPO_PUBLIC_SENTRY_DSN is set (a founder step
// — launch-gate 2.1), exactly like analytics.ts is inert without a PostHog host,
// and the SDK is loaded guardedly so its absence means "no reporting", not a
// crash.
//
// The reason this file is careful rather than three lines: **an unfiltered
// Sentry event carries more of the journal than any analytics event would.** A
// default React Native install ships breadcrumbs of every fetch and every console
// call, the request body of failed HTTP calls, and — with sendDefaultPii — device
// identifiers. The resolver POSTs the user's line to an Edge Function, so an
// unfiltered breadcrumb of that request IS the journal. Everything below exists
// to make that impossible by construction rather than by remembering.

import type { Screen } from './analytics';
import { env } from './env';

/**
 * Where the error happened — never what the user typed. A closed key set rather
 * than Record<string, unknown> so `{ line: raw }` cannot be added at a call site
 * without coming through here first. Values are developer literals.
 */
export interface ErrorContext {
  /** Route the user was on. */
  screen?: Screen;
  /** Named operation, e.g. 'syncTick', 'pullReference'. A code literal. */
  op?: string;
  /** Set by an error boundary. */
  boundary?: 'root';
}

// --- minimal typed surface of @sentry/react-native --------------------------

/** A Sentry event, as much of it as beforeSend needs to strip. */
export interface SentryEvent {
  request?: unknown;
  breadcrumbs?: unknown;
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  user?: unknown;
  message?: unknown;
}

export interface SentryClient {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown, hint?: Record<string, unknown>): void;
}

function requireSdk(): SentryClient | null {
  try {
    // Not a dependency yet: installing it is gated on the Sentry account and on
    // the DPDP processor terms (launch-gate 2.1). Until then this throws and
    // reporting stays inert — the same guarded-require shape as revenuecat.ts
    // and analytics.ts, so wiring it later is one `npm i` and no code change.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@sentry/react-native') as SentryClient;
  } catch {
    return null;
  }
}

let loadSdk: () => SentryClient | null = requireSdk;
let client: SentryClient | null = null;
let configured = false;

/**
 * Strip everything that could carry journal content off an outgoing event.
 *
 * Exported because it IS the compliance guarantee, and a guarantee that is only
 * exercised in production is a guarantee nobody has checked. Its tests are the
 * negative kind: given an event stuffed with a request body and breadcrumbs of
 * the resolver call, nothing recognisable survives.
 *
 * Allow-list, not deny-list. A deny-list is wrong here because the next Sentry
 * version can add a field that carries user content, and this code would not
 * know to remove it.
 */
export function scrubEvent(event: SentryEvent): SentryEvent {
  return {
    // The request body of a failed classify POST is the user's line, verbatim.
    request: undefined,
    // Breadcrumbs are a transcript of every fetch and console call before the
    // crash — including the resolver hop.
    breadcrumbs: undefined,
    // `extra` and `contexts` are where a well-meaning call site puts "the row
    // that failed". Nothing in Slate needs either to be reported.
    extra: undefined,
    contexts: undefined,
    // No device id, no IP, no anything. identify() lives in analytics.ts and is
    // auth.uid() with no traits; a crash does not need even that.
    user: undefined,
    // The message is a developer literal from a `throw new Error(...)`, but a
    // Supabase error message can carry a project ref or a request id, so it is
    // dropped too. The stack trace is what makes a crash actionable.
    message: undefined,
  };
}

/**
 * Boot-time wiring. Safe to call when the SDK is absent or no DSN is set (both
 * no-ops), and safe to call repeatedly (configures once).
 */
export function configureReporting(): void {
  if (configured) return;
  configured = true;
  const dsn = env.sentryDsn;
  const sdk = dsn ? loadSdk() : null;
  if (!dsn || !sdk) return; // intentionally off, or no native module here
  try {
    sdk.init({
      dsn,
      // Off, permanently. These are the two defaults that would ship the journal.
      sendDefaultPii: false,
      // No automatic breadcrumb capture at all — scrubEvent drops them anyway,
      // but not collecting them means they never sit in memory either.
      maxBreadcrumbs: 0,
      enableAutoSessionTracking: false,
      // Crashes only. Performance tracing samples request URLs, and a resolver
      // URL with a query string is not something we need.
      tracesSampleRate: 0,
      beforeSend: (event: SentryEvent) => scrubEvent(event),
      // A breadcrumb that is never recorded cannot be sent; belt and braces
      // against a future default that re-enables collection.
      beforeBreadcrumb: () => null,
    });
    client = sdk;
  } catch {
    client = null;
  }
}

/** Report a caught error that would otherwise vanish into a silent catch. */
export function reportError(error: unknown, context?: ErrorContext): void {
  if (__DEV__) {
    console.error('[report]', error, context ?? {});
  }
  if (!client) return;
  try {
    // `tags` rather than `extra`: tags are indexed and searchable, and both
    // values here are developer literals from the closed ErrorContext above.
    client.captureException(error, {
      tags: { screen: context?.screen, op: context?.op, boundary: context?.boundary },
    });
  } catch {
    // Reporting must never be the reason something fails.
  }
}

/** Test seam. Replaces the SDK client without a native module. */
export function __setClientForTest(next: SentryClient | null, isConfigured = true): void {
  client = next;
  configured = isConfigured;
}

/** Test seam. Supplies the module configureReporting would have required. */
export function __setSdkLoaderForTest(loader: (() => SentryClient | null) | null): void {
  loadSdk = loader ?? requireSdk;
}

/** Test seam. Back to a cold module. */
export function __resetForTest(): void {
  client = null;
  configured = false;
  loadSdk = requireSdk;
}
