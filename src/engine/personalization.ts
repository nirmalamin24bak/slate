// Personalization is a bounded modifier, not an authority (spec/05). The clamp
// lives here in the engine — the model cannot be argued out of a Math.min.

import { PERSONALIZATION_FAT_BOUND, PERSONALIZATION_TOTAL_BOUND } from './constants';
import type { Nutrition, PersonalizationFactors } from './types';
import { scale } from './nutrition';

function clamp(value: number, bound: number): number {
  return Math.min(Math.max(value, 1 - bound), 1 + bound);
}

/** Final-kcal multiplier, hard-bounded to ±20%. */
export function clampTotalFactor(factor: number): number {
  return clamp(factor, PERSONALIZATION_TOTAL_BOUND);
}

/** Cooking-fat multiplier, hard-bounded to ±30%. Applied to oil ml, not macros. */
export function clampFatFactor(factor: number): number {
  return clamp(factor, PERSONALIZATION_FAT_BOUND);
}

/**
 * Apply the bounded total factor to a computed nutrition. Scales every field
 * proportionally — a leaner poha stays a coherent poha. The fat factor acts on
 * cooking oil upstream (computeEntry), never here.
 */
export function applyPersonalization(
  n: Nutrition,
  factors: PersonalizationFactors | null,
): Nutrition {
  if (!factors || factors.total === undefined) return n;
  return scale(n, clampTotalFactor(factors.total));
}
