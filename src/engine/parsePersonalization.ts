// Parse profiles.personalization free text → bounded PersonalizationFactors
// (spec/05). This is a user-authored instruction flowing into a system that
// outputs numbers, so it is read conservatively: only a handful of cooking
// habits move a factor at all, and the engine clamps whatever comes out
// (±20% total, ±30% fat). "everything I eat is 50 calories" yields a slightly
// leaner dish, never a lie. Absent any recognised phrase → null (no effect).
//
// Deliberately NOT an LLM call: the model could be talked out of the clamp;
// keyword matching cannot. Pure and testable.

import type { PersonalizationFactors } from './types';

interface Rule {
  test: RegExp;
  total?: number;
  fat?: number;
}

// Multipliers here are intentionally past the clamp bounds — the engine's
// clampTotalFactor / clampFatFactor pull them to the ±20% / ±30% edge. Their
// only job is direction and "as far as allowed".
const RULES: readonly Rule[] = [
  { test: /\b(very little|hardly any|minimal|no)\s+oil\b/, fat: 0.5 },
  { test: /\b(less|little|low)\s+oil\b/, fat: 0.75 },
  { test: /\b(lots of|extra|heavy|more)\s+oil\b/, fat: 1.5 },
  { test: /\b(small|smaller)\s+(katori|portion|helping|serving)/, total: 0.7 },
  { test: /\b(large|big|bigger|heaped)\s+(katori|portion|helping|serving)/, total: 1.3 },
  { test: /\b(light eater|eat light|small eater|small appetite)\b/, total: 0.7 },
  { test: /\b(big eater|large appetite|hearty)\b/, total: 1.3 },
  { test: /\b(low[- ]?cal|lean|light on calories|diet)\b/, total: 0.7 },
];

/**
 * Combine every matching rule multiplicatively. Returns null when nothing
 * matches so recompute can skip the personalization step entirely.
 */
export function parsePersonalization(text: string | null): PersonalizationFactors | null {
  if (!text) return null;
  const normalized = text.toLowerCase();

  let total = 1;
  let fat = 1;
  let matched = false;
  for (const rule of RULES) {
    if (!rule.test.test(normalized)) continue;
    matched = true;
    if (rule.total !== undefined) total *= rule.total;
    if (rule.fat !== undefined) fat *= rule.fat;
  }
  if (!matched) return null;

  const factors: PersonalizationFactors = {};
  if (total !== 1) factors.total = total;
  if (fat !== 1) factors.fat = fat;
  return factors;
}
