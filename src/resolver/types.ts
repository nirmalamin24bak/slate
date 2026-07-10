// Resolver types (spec/05). The model's output crosses an untrusted boundary:
// nothing here trusts a ref, a number, or a string until validate() has
// checked it against the catalogue and the unit vocabulary.

import type { EntryContext, FoodUnit } from '../engine/types';

export const INTENTS = ['food', 'exercise', 'weight', 'water', 'steps', 'sleep'] as const;
export type Intent = (typeof INTENTS)[number];

/** Full spec/05 unit vocabulary; FoodUnit covers the food subset. */
export type ResolverUnit = FoodUnit | 'minutes' | 'km' | 'steps' | 'hours';

/**
 * One resolved journal line. `unresolved` carries the failure honestly —
 * never a nearest-neighbour guess (spec/09).
 */
export interface Resolution {
  intent: Intent | 'unresolved';
  /** dish id | exercise id | barcode. Null for weight/water/steps/sleep and unresolved. */
  ref: string | null;
  qty: number | null;
  unit: ResolverUnit | null;
  context: EntryContext;
  confidence: number;
}

/**
 * Id sets the validator checks refs against. Injected, not fetched — the
 * validator stays pure and the caller decides freshness.
 */
export interface Catalogue {
  dishes: ReadonlySet<string>;
  exercises: ReadonlySet<string>;
  packagedFoods: ReadonlySet<string>;
  /** per-user custom dishes (Plus); empty set until Phase 5 wires them */
  customDishes: ReadonlySet<string>;
}

export const UNRESOLVED: Resolution = {
  intent: 'unresolved',
  ref: null,
  qty: null,
  unit: null,
  context: 'home',
  confidence: 0,
} as const;
