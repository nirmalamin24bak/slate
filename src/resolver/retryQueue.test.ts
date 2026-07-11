import { describe, expect, it } from 'vitest';

import { backoffMs, MAX_ATTEMPTS, RetryQueue } from './retryQueue';

// spec/09: resolver failures queue for retry — oldest first, exponential
// backoff, rate-limited drain, no user-facing error. Pure scheduling logic;
// the db layer persists the queue in Phase 3.

describe('backoffMs', () => {
  it('grows exponentially from 1s and caps at 5 minutes', () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(20)).toBe(300000);
  });
});

describe('RetryQueue', () => {
  it('drains oldest first', () => {
    const q = new RetryQueue<string>();
    q.push('a', 0);
    q.push('b', 1);
    expect(q.due(10000).map((i) => i.item)).toEqual(['a', 'b']);
  });

  it('an item is not due until its backoff has elapsed', () => {
    const q = new RetryQueue<string>();
    q.push('a', 0); // attempt 0 → due at 1000
    expect(q.due(999)).toEqual([]);
    expect(q.due(1000).map((i) => i.item)).toEqual(['a']);
  });

  it('requeueing bumps the attempt and pushes the due time out', () => {
    const q = new RetryQueue<string>();
    q.push('a', 0);
    const [first] = q.due(1000);
    q.requeue(first!, 1000); // attempt 1 → due at 1000 + 2000
    expect(q.due(2999)).toEqual([]);
    expect(q.due(3000).map((i) => i.item)).toEqual(['a']);
  });

  it('due() removes what it returns; size tracks the rest', () => {
    const q = new RetryQueue<string>();
    q.push('a', 0);
    q.push('b', 0);
    expect(q.size).toBe(2);
    q.due(1000);
    expect(q.size).toBe(0);
  });

  it('push dedups: the same item queued twice is one entry', () => {
    const q = new RetryQueue<string>();
    q.push('a', 0);
    q.push('a', 5); // duplicate from another code path
    expect(q.size).toBe(1);
    expect(q.has('a')).toBe(true);
    expect(q.has('b')).toBe(false);
  });

  it('requeue returns true under the cap and re-queues', () => {
    const q = new RetryQueue<string>();
    q.push('a', 0);
    const [first] = q.due(1000);
    expect(q.requeue(first!, 1000)).toBe(true);
    expect(q.size).toBe(1);
  });

  it('requeue returns false at the attempt cap and drops the item', () => {
    const q = new RetryQueue<string>();
    q.push('a', 0); // attempt 0
    // Each drain-then-requeue bumps the attempt: 0→1, 1→2, … Requeue succeeds
    // while the resulting attempt stays under MAX_ATTEMPTS, then refuses.
    let now = 0;
    for (let resultingAttempt = 1; resultingAttempt < MAX_ATTEMPTS; resultingAttempt++) {
      now += backoffMs(resultingAttempt) + 1;
      const entry = q.due(now)[0]!;
      expect(q.requeue(entry, now)).toBe(true);
    }
    // The next requeue would reach MAX_ATTEMPTS: refused, item dropped.
    now += backoffMs(MAX_ATTEMPTS) + 1;
    const last = q.due(now)[0]!;
    expect(q.requeue(last, now)).toBe(false);
    expect(q.size).toBe(0);
  });
});
