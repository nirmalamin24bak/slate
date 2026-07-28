// Central error sink. Every swallowed catch and the root error boundary route
// through here so there is one place to wire crash reporting (Sentry).
//
// Product analytics is NOT here — it lives in analytics.ts behind a closed event
// union, because spec/08 forbids `raw_text` reaching a vendor and a
// `report(name: string, props)` signature is how that happens by accident. The
// free-form reportEvent that used to sit in this file was already carrying a
// Supabase error message and a journal entry id into a would-be PostHog payload.
//
// Until Sentry is provisioned (a founder-gated account step — launch-gate 2.1)
// this is a dev-only console sink. The signature is the contract: wiring the SDK
// later touches this file alone, never the ~dozen call sites.

import type { Screen } from './analytics';

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

/** Report a caught error that would otherwise vanish into a silent catch. */
export function reportError(error: unknown, context?: ErrorContext): void {
  if (__DEV__) {
    console.error('[report]', error, context ?? {});
  }
  // TODO(C1): Sentry.captureException(error, { extra: context })
  //
  // When wiring it: beforeSend must drop the request body and strip breadcrumbs,
  // and sendDefaultPii stays false. An unfiltered Sentry event carries more of
  // the journal than any analytics event would.
}
