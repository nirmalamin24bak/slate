// Local mirror of the global resolution_cache, behind the resolver's
// CacheStore interface. The authoritative global row is written server-side
// by the classify Edge Function; this mirror only saves round-trips.

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

export function sqliteCacheStore(adapter: SqlAdapter): CacheStore {
  return {
    async get(normalized: string): Promise<CachedResolution | null> {
      const row = await adapter.get<CacheRow>(
        'SELECT normalized_text, intent, resolved_ref, qty, unit, confidence FROM resolution_cache WHERE normalized_text = ?',
        [normalized],
      );
      if (!row) return null;
      return {
        intent: row.intent,
        ref: row.resolved_ref,
        qty: row.qty,
        unit: row.unit,
        confidence: row.confidence,
      };
    },
    async put(normalized: string, value: CachedResolution): Promise<void> {
      await adapter.run(
        `INSERT INTO resolution_cache (normalized_text, intent, resolved_ref, qty, unit, confidence, hit_count)
         VALUES (?,?,?,?,?,?,1)
         ON CONFLICT (normalized_text) DO UPDATE SET
           intent = excluded.intent,
           resolved_ref = excluded.resolved_ref,
           qty = excluded.qty,
           unit = excluded.unit,
           confidence = excluded.confidence,
           hit_count = resolution_cache.hit_count + 1`,
        [normalized, value.intent, value.ref, value.qty, value.unit, value.confidence],
      );
    },
  };
}
