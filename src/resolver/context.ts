// spec/05 `context` flag. Pure function of the normalized text — it must be,
// because resolution_cache has no context column, so a cache hit can only
// reconstruct context from the text itself. Restaurant food runs 30-40% hot;
// the engine applies the multipliers, this just raises the flag.

import type { EntryContext } from '../engine/types';

// The seven spec tokens, plus the Hinglish ways users actually write them.
// MUST stay identical to OUTSIDE_TOKENS in
// supabase/functions/resolver-classify/index.ts — the cache-write side
// reconstructs context from the same token scan, and drift silently caches a
// wrong-context (wrong-calorie) row. The list is exported and pinned in
// context.test.ts so client-side drift is caught; the edge copy is reviewed by
// hand against this one.
export const OUTSIDE_TOKENS_LIST = [
  'swiggy',
  'zomato',
  'ordered',
  'outside',
  'hotel',
  'restaurant',
  'canteen',
  'bahar', // Hinglish "outside"
  'dhaba',
] as const;

const OUTSIDE_TOKENS: ReadonlySet<string> = new Set(OUTSIDE_TOKENS_LIST);

export function contextOf(normalized: string): EntryContext {
  for (const word of normalized.split(' ')) {
    if (OUTSIDE_TOKENS.has(word)) return 'outside';
  }
  return 'home';
}
