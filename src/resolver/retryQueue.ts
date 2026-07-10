// spec/09 offline + resolver-failure queue: oldest first, exponential
// backoff, no user-facing error. Pure scheduling — callers supply `now`, so
// tests never sleep and Phase 3 can persist items in SQLite.

const BASE_MS = 1000;
const CAP_MS = 5 * 60 * 1000;

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

  push(item: T, now: number): void {
    this.entries.push({ item, attempt: 0, dueAt: now + backoffMs(0), seq: this.nextSeq++ });
  }

  /** Remove and return every entry due at `now`, oldest first. */
  due(now: number): QueueEntry<T>[] {
    const ready = this.entries.filter((e) => e.dueAt <= now).sort((a, b) => a.seq - b.seq);
    this.entries = this.entries.filter((e) => e.dueAt > now);
    return ready;
  }

  /** Put a failed entry back with one more attempt on the clock. */
  requeue(entry: QueueEntry<T>, now: number): void {
    const attempt = entry.attempt + 1;
    this.entries.push({ ...entry, attempt, dueAt: now + backoffMs(attempt) });
  }
}
