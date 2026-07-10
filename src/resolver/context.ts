// spec/05 `context` flag. Pure function of the normalized text — it must be,
// because resolution_cache has no context column, so a cache hit can only
// reconstruct context from the text itself. Restaurant food runs 30-40% hot;
// the engine applies the multipliers, this just raises the flag.

import type { EntryContext } from '../engine/types';

// The seven spec tokens, plus the Hinglish ways users actually write them.
const OUTSIDE_TOKENS: ReadonlySet<string> = new Set([
  'swiggy',
  'zomato',
  'ordered',
  'outside',
  'hotel',
  'restaurant',
  'canteen',
  'bahar', // Hinglish "outside"
  'dhaba',
]);

export function contextOf(normalized: string): EntryContext {
  for (const word of normalized.split(' ')) {
    if (OUTSIDE_TOKENS.has(word)) return 'outside';
  }
  return 'home';
}
