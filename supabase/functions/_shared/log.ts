// Structured logging for the Edge Functions. One line of JSON per request.
//
// Audit C8: none of the four functions emitted anything. Errors were caught and
// converted to opaque JSON (`{ error: 'classify failed' }`) with the cause
// discarded, so a provider outage, a budget exhaustion, a poisoned cache write
// and a webhook RevenueCat had given up retrying were all indistinguishable
// from silence. The first signal of any of them would have been a bill or an
// App Store review.
//
// The rule that shapes this file is the same one that shapes src/lib/analytics.ts,
// for the same reason (spec/08): **the journal line never leaves the resolver
// hop.** Not truncated, not hashed, not "just for debugging" — a log is a
// vendor's disk like any other. So `fields` is a closed type. There is no
// `log(event, arbitraryObject)`, because that signature is how `raw_text` ends
// up in a log aggregator by accident, and a reviewer cannot grep for a mistake
// that the type system permits.
//
// Supabase collects stdout from Edge Functions, so console.log IS the transport.
// JSON rather than prose because these lines are meant to be queried — "p95
// latency by source", "what fraction of calls were served from cache", "how much
// did yesterday cost" — not read.

/** Which function emitted the line. */
export type Fn =
  'resolver-classify' | 'delete-account' | 'revenuecat-webhook' | 'entitlement-refresh';

/**
 * Everything a log line may carry. Deliberately absent: the journal line, the
 * normalized phrase, the model's reply, the RevenueCat event body, and anything
 * else derived from what a user typed or bought.
 *
 * `user` is auth.uid() — the same identifier analytics uses, and the only one
 * that lets a support question ("my Plus vanished") be answered at all.
 */
export interface LogFields {
  /** Outcome bucket. `ok` or a short reason; never a raw error message. */
  outcome: string;
  /** HTTP status returned to the caller. */
  status: number;
  /** Wall time for the whole request. */
  ms?: number;
  /** auth.uid(), where the request has one. */
  user?: string;
  /** Which stage answered a classify: the cost signal (spec/05 wants >90% cache). */
  source?: 'cache' | 'model';
  /** Whether the caller was Plus — the budget pool the call was charged to. */
  plus?: boolean;
  /** Model spend, per call. The number the daily ceiling is supposed to bound. */
  inputTokens?: number;
  /** Input tokens served from the provider's prompt cache rather than billed fresh. */
  cachedTokens?: number;
  outputTokens?: number;
  /** RevenueCat event type, e.g. 'RENEWAL'. A vocabulary of ours, not user data. */
  event?: string;
  /** Error CLASS, never the message: 'timeout', 'provider', 'catalogue'. */
  errorKind?: string;
}

/**
 * Emit one line. `level` drives alerting: anything at `error` is something a
 * human should see, `warn` is a guard doing its job (a rate limit, a refused
 * payload), `info` is the happy path.
 */
export function log(fn: Fn, level: 'info' | 'warn' | 'error', fields: LogFields): void {
  try {
    console.log(JSON.stringify({ fn, level, at: new Date().toISOString(), ...fields }));
  } catch {
    // A log must never be the reason a request fails.
  }
}

/**
 * Classify a thrown value into a short, loggable kind. The message itself is
 * dropped: a provider error can quote the prompt back, and the prompt contains
 * the user's line.
 */
export function errorKind(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error) {
    if (error.message === 'catalogue load failed') return 'catalogue';
    if (error.message.includes('RESOLVER_PROVIDER_API_KEY')) return 'misconfigured';
  }
  return 'provider';
}
