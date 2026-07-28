// Local mirror of the global resolution_cache, behind the resolver's
// CacheStore interface. The authoritative global row is written server-side
// by the classify Edge Function; this mirror only saves round-trips.
//
// It is bounded. Before this it grew for the life of the install (audit): every
// distinct phrase a user ever typed kept a row forever, on a device, for a
// journal whose whole promise is that it opens instantly. The bound is large
// enough that the head of the distribution — the few hundred phrases anyone
// actually repeats — never gets evicted, and eviction is by usage, so what goes
// is the line typed once in March.

import type { CachedResolution, CacheStore } from '../resolver/resolve';
import type { Intent, ResolverUnit } from '../resolver/types';
import type { SqlAdapter } from './adapter';

interface CacheRow {
  normalized_text: string;
  intent: Intent;
  resolved_ref: string | null;
  qty: number | null;
  unit: ResolverUnit | null;
  confidence: number;
}

/**
 * Rows kept on device. spec/05 puts the >90% hit rate in short head-of-
 * distribution phrases; a real user's repeated vocabulary is in the hundreds,
 * so this is several times more headroom than the cache needs while staying
 * trivially small on disk.
 */
export const MAX_LOCAL_CACHE_ROWS = 2000;

/** Prune the least-used rows once the mirror exceeds its bound. */
async function evictExcess(adapter: SqlAdapter): Promise<void> {
  const row = await adapter.get<{ n: number }>('SELECT COUNT(*) AS n FROM resolution_cache');
  const excess = (row?.n ?? 0) - MAX_LOCAL_CACHE_ROWS;
  if (excess <= 0) return;
  // Least hits first, then least recently used. A row that has never been read
  // back (last_hit_at null) sorts before one that has, which is what we want:
  // it was written once and never needed again.
  await adapter.run(
    `DELETE FROM resolution_cache WHERE normalized_text IN (
       SELECT normalized_text FROM resolution_cache
       ORDER BY hit_count ASC, last_hit_at IS NOT NULL ASC, last_hit_at ASC
       LIMIT ?
     )`,
    [excess],
  );
}

export interface CacheStoreOptions {
  /** Injected so eviction order is deterministic in tests (no wall clock). */
  now?: () => Date;
}

export function sqliteCacheStore(adapter: SqlAdapter, options: CacheStoreOptions = {}): CacheStore {
  const now = options.now ?? (() => new Date());
  return {
    async get(normalized: string): Promise<CachedResolution | null> {
      const row = await adapter.get<CacheRow>(
        'SELECT normalized_text, intent, resolved_ref, qty, unit, confidence FROM resolution_cache WHERE normalized_text = ?',
        [normalized],
      );
      if (!row) return null;
      // A read is the usage signal eviction sorts on — without it the mirror
      // would evict by write order and drop the phrases people actually repeat.
      await adapter.run(
        'UPDATE resolution_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE normalized_text = ?',
        [now().toISOString(), normalized],
      );
      return {
        intent: row.intent,
        ref: row.resolved_ref,
        qty: row.qty,
        unit: row.unit,
        confidence: row.confidence,
      };
    },
    async put(normalized: string, value: CachedResolution): Promise<void> {
      const nowIso = now().toISOString();
      await adapter.run(
        `INSERT INTO resolution_cache (normalized_text, intent, resolved_ref, qty, unit, confidence, hit_count, last_hit_at)
         VALUES (?,?,?,?,?,?,1,?)
         ON CONFLICT (normalized_text) DO UPDATE SET
           intent = excluded.intent,
           resolved_ref = excluded.resolved_ref,
           qty = excluded.qty,
           unit = excluded.unit,
           confidence = excluded.confidence,
           hit_count = resolution_cache.hit_count + 1,
           last_hit_at = excluded.last_hit_at`,
        [normalized, value.intent, value.ref, value.qty, value.unit, value.confidence, nowIso],
      );
      await evictExcess(adapter);
    },
  };
}
