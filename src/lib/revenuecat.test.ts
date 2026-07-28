import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __setCurrentForTest,
  getEntitlements,
  markOptimistic,
  setServerEntitlement,
} from './revenuecat';

// Server-authoritative reconcile (plan B2). The server row is truth; the RC
// SDK value can only ADD Plus, and only inside the optimistic window after a
// purchase. These assert the matrix directly on getEntitlements.

describe('getEntitlements reconcile', () => {
  beforeEach(() => {
    // Reset module state between cases.
    __setCurrentForTest({ plus: false });
    setServerEntitlement(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('server false + SDK false → free', () => {
    setServerEntitlement(false);
    __setCurrentForTest({ plus: false });
    expect(getEntitlements().plus).toBe(false);
  });

  it('server true → Plus regardless of SDK', () => {
    setServerEntitlement(true);
    __setCurrentForTest({ plus: false });
    expect(getEntitlements().plus).toBe(true);
  });

  it('server false + SDK true, inside the optimistic window → Plus', () => {
    vi.useFakeTimers();
    setServerEntitlement(false);
    __setCurrentForTest({ plus: true });
    markOptimistic(); // opens a 60s window from "now"
    expect(getEntitlements().plus).toBe(true);
  });

  it('server false + SDK true, after the optimistic window → free', () => {
    vi.useFakeTimers();
    setServerEntitlement(false);
    __setCurrentForTest({ plus: true });
    markOptimistic();
    vi.advanceTimersByTime(61_000); // past the 60s window
    expect(getEntitlements().plus).toBe(false); // a spoofed SDK cannot hold Plus
  });

  it('server true + SDK false (lapsed elsewhere) → free once the row is false', () => {
    setServerEntitlement(false);
    __setCurrentForTest({ plus: false });
    expect(getEntitlements().plus).toBe(false);
  });
});
