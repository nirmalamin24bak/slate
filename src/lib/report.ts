// Central error/telemetry sink. Every swallowed catch and the root error
// boundary route through here so there is one place to wire crash reporting
// (Sentry) and product analytics (PostHog) — see docs/analytics-handoff.md.
//
// Until those SDKs are provisioned (a founder-gated account step), this is a
// dev-only console sink. The signature is the contract: wiring Sentry later
// touches this file alone, never the ~dozen call sites.

type Context = Record<string, string | number | boolean | null | undefined>;

/** Report a caught error that would otherwise vanish into a silent catch. */
export function reportError(error: unknown, context?: Context): void {
  if (__DEV__) {
    console.error('[report]', error, context ?? {});
  }
  // TODO(C1): Sentry.captureException(error, { extra: context })
}

/** Report a named product/reliability event (queue depth, sync failure, …). */
export function reportEvent(name: string, props?: Context): void {
  if (__DEV__) {
    console.log('[event]', name, props ?? {});
  }
  // TODO(C1): posthog.capture(name, props)
}
