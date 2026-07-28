// spec/09 offline + resolver-failure queue: oldest first, exponential
// backoff, no user-facing error. Pure scheduling — callers supply `now`, so
// tests never sleep and Phase 3 can persist items in SQLite.

const BASE_MS = 1000;
const CAP_MS = 5 * 60 * 1000;

/**
 * Give up after this many attempts. Without a ceiling a line the server will
 * never resolve retries every 5 min forever — waking the app, draining the
 * battery, and (once online) billing an Edge Function call each time. Past the
 * cap the caller marks the line non-retryable and leaves the manual ↻.
 */
export const MAX_ATTEMPTS = 8;

export function backoffMs(attempt: number): number {
  return Math.min(BASE_MS * 2 ** attempt, CAP_MS);
}

export interface QueueEntry<T> {
  item: T;
  attempt: number;
  dueAt: number;
  /** insertion order; preserved across requeues so drains stay oldest-first */
  seq: number;
}

export class RetryQueue<T> {
  private entries: QueueEntry<T>[] = [];
  private nextSeq = 0;

  get size(): number {
    return this.entries.length;
  }

  /** Is this item already queued? (identity by ===; T is an id string here.) */
  has(item: T): boolean {
    return this.entries.some((e) => e.item === item);
  }

  /**
   * Queue an item once. A no-op if it is already present — the same entry id
   * is pushed from several code paths (restore, resolve-failure, recompute),
   * and duplicates would drive duplicate model calls for one line.
   */
  push(item: T, now: number): void {
    if (this.has(item)) return;
    this.entries.push({ item, attempt: 0, dueAt: now + backoffMs(0), seq: this.nextSeq++ });
  }

  /** Remove and return every entry due at `now`, oldest first. */
  due(now: number): QueueEntry<T>[] {
    const ready = this.entries.filter((e) => e.dueAt <= now).sort((a, b) => a.seq - b.seq);
    this.entries = this.entries.filter((e) => e.dueAt > now);
    return ready;
  }

  /**
   * Put a failed entry back with one more attempt on the clock. Returns false
   * (and does NOT requeue) once the attempt cap is reached, so the caller can
   * mark the line permanently unresolved.
   */
  requeue(entry: QueueEntry<T>, now: number): boolean {
    const attempt = entry.attempt + 1;
    if (attempt >= MAX_ATTEMPTS) return false;
    this.entries.push({ ...entry, attempt, dueAt: now + backoffMs(attempt) });
    return true;
  }
}
