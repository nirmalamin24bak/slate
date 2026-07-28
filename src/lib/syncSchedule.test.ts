// Audit M5. The curve matters in both directions: too eager and the app is the
// dominant load on one Postgres at scale, too lazy and a cross-device edit takes
// minutes to appear.

import { describe, expect, it } from 'vitest';

import { MAX_SYNC_MS, MIN_SYNC_MS, nextSyncDelay } from './syncSchedule';

describe('nextSyncDelay', () => {
  it('stays at the floor while work is happening', () => {
    expect(nextSyncDelay(0)).toBe(MIN_SYNC_MS);
  });

  it('doubles while nothing is happening', () => {
    expect(nextSyncDelay(1)).toBe(60_000);
    expect(nextSyncDelay(2)).toBe(120_000);
    expect(nextSyncDelay(3)).toBe(240_000);
  });

  it('never exceeds the ceiling', () => {
    expect(nextSyncDelay(4)).toBe(MAX_SYNC_MS);
    expect(nextSyncDelay(50)).toBe(MAX_SYNC_MS);
    // 2 ** 1024 overflows to Infinity; the guard must hold there too.
    expect(nextSyncDelay(5000)).toBe(MAX_SYNC_MS);
  });

  it('treats a negative count as activity, not as deep idleness', () => {
    expect(nextSyncDelay(-1)).toBe(MIN_SYNC_MS);
  });

  it('takes a realistic idle session well under an hour of polling', () => {
    // An hour idle, following the curve: count the ticks it would cost. The flat
    // 30s interval would have been 120.
    let elapsed = 0;
    let idle = 0;
    let ticks = 0;
    while (elapsed < 60 * 60_000) {
      elapsed += nextSyncDelay(idle);
      idle++;
      ticks++;
    }
    expect(ticks).toBeLessThan(20);
  });
});
