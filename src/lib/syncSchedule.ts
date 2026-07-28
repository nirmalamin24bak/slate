// How often the journal asks the server whether anything changed.
//
// Audit M5: the tick was a flat 30-second setInterval, and every tick ran a full
// push plus FOUR paged selects (entries, weights, profiles, kitchen) whether or
// not anything had changed. For one idle user with the app open that is ten
// round trips a minute for nothing. At 100k DAU it is the dominant load on a
// single Postgres, and on the user's side it is cellular data and battery spent
// re-confirming an unchanged journal.
//
// The fix is not a longer interval — that would make a real cross-device edit
// take minutes to appear. It is to stay fast while something is happening and
// back off while nothing is. A tick that moved data resets to the floor, so the
// first change after a quiet hour is still picked up within 30 seconds of the
// next poll, and every subsequent one is prompt.
//
// Pure and separate from the screen so the curve is testable; app/index.tsx owns
// only the timer.

/** Fast path: what the interval was before, and what it returns to on activity. */
export const MIN_SYNC_MS = 30_000;

/**
 * Ceiling. Five minutes because the other wake-ups still exist and are the real
 * latency guarantee for an idle app: a network state change and an app
 * foreground both trigger a tick directly. This interval only covers the case of
 * the app sitting open, untouched, on a live connection.
 */
export const MAX_SYNC_MS = 5 * 60_000;

/**
 * Delay before the next tick, given how many consecutive ticks found nothing.
 *
 * Doubling from the floor: 30s, 60s, 2m, 4m, then capped at 5m. Reaching the cap
 * takes about seven and a half minutes of genuine idleness, so an ordinary
 * session of typing and pausing never leaves the fast path.
 */
export function nextSyncDelay(consecutiveIdle: number): number {
  if (consecutiveIdle <= 0) return MIN_SYNC_MS;
  const doubled = MIN_SYNC_MS * 2 ** consecutiveIdle;
  // Guard the exponent as well as the result: 2 ** 1024 is Infinity, and
  // Math.min(Infinity, MAX) is fine, but NaN would not be.
  return Number.isFinite(doubled) ? Math.min(doubled, MAX_SYNC_MS) : MAX_SYNC_MS;
}
