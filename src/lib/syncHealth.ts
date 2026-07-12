// Sync health (audit D4) — a client-visible "is my data reaching the server?"
// signal. syncTick previously swallowed every push/pull error into reportError,
// which is a no-op in production, so a row that fails to sync forever (e.g. it
// violates a server CHECK the client didn't) stays dirty silently: the user
// sees it locally, assumes it's backed up, and loses it on reinstall.
//
// This tracks consecutive syncTick failures. One poison row makes every tick
// throw, so a global consecutive-failure count captures the stuck case without
// per-row bookkeeping. After BACKED_UP_FAIL_THRESHOLD consecutive failures the
// journal can show a quiet "not backed up" affordance; a single success clears
// it. Same useSyncExternalStore shape as remoteConfig, so a component reads it
// with one hook and no prop-drilling.
//
// This is the surface + the counter. A richer per-row dead-letter (mark a row
// non-syncable after N attempts, like the resolver queue's retryable=0) is the
// deferred follow-up; the global signal is what a user actually needs to see.

import { useSyncExternalStore } from 'react';

// Consecutive failed ticks before we consider the local store not-backed-up.
// A handful of transient offline ticks should not raise it; a genuinely stuck
// push crosses it within a minute or two of ticks.
export const BACKED_UP_FAIL_THRESHOLD = 5;

export interface SyncHealth {
  /** true until we've failed to sync BACKED_UP_FAIL_THRESHOLD ticks in a row. */
  backedUp: boolean;
  /** consecutive failed syncTicks; reset to 0 on any success. */
  consecutiveFailures: number;
  /** ms epoch of the last fully successful syncTick, or null if never. */
  lastSyncedAt: number | null;
}

const INITIAL: SyncHealth = { backedUp: true, consecutiveFailures: 0, lastSyncedAt: null };

let current: SyncHealth = INITIAL;
const listeners = new Set<() => void>();

export function getSyncHealth(): SyncHealth {
  return current;
}

export function subscribeSyncHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the live sync health (the "not backed up" hint). */
export function useSyncHealth(): SyncHealth {
  return useSyncExternalStore(subscribeSyncHealth, getSyncHealth);
}

function set(next: SyncHealth): void {
  if (
    next.backedUp === current.backedUp &&
    next.consecutiveFailures === current.consecutiveFailures &&
    next.lastSyncedAt === current.lastSyncedAt
  )
    return;
  current = next;
  for (const fn of listeners) fn();
}

/** Called by syncTick when a full push+pull cycle succeeds. */
export function recordSyncSuccess(nowMs: number): void {
  set({ backedUp: true, consecutiveFailures: 0, lastSyncedAt: nowMs });
}

/** Called by syncTick when the push+pull cycle throws. */
export function recordSyncFailure(): void {
  const consecutiveFailures = current.consecutiveFailures + 1;
  set({
    backedUp: consecutiveFailures < BACKED_UP_FAIL_THRESHOLD,
    consecutiveFailures,
    lastSyncedAt: current.lastSyncedAt,
  });
}

/** Reset to initial (tests, and a user switching identity on adoption). */
export function resetSyncHealth(): void {
  current = INITIAL;
  for (const fn of listeners) fn();
}
