// spec/05 step 4 — the untrusted-LLM boundary. Model output is parsed
// strictly and checked field by field; any failure collapses to `unresolved`.
// Nothing the model says can name a ref outside the catalogue, move a number
// past the sanity caps, or escape as an exception into the journal.

import type { FoodUnit } from '../engine/types';
import type { Catalogue, Intent, Resolution, ResolverUnit } from './types';
import { INTENTS, UNRESOLVED } from './types';

export const CONFIDENCE_FLOOR = 0.6;

const LB_TO_KG = 0.453592;

const FOOD_UNITS: ReadonlySet<string> = new Set<FoodUnit>([
  'katori',
  'plate',
  'glass',
  'cup',
  'piece',
  'roti',
  'tbsp',
  'tsp',
  'g',
  'ml',
  'kg',
  'l',
]);

/** Engineering sanity caps, not product rules: reject → unresolved. */
const QTY_CAPS: Readonly<Record<Intent, number>> = {
  food: 10000,
  exercise: 1440, // minutes; km checked separately
  weight: 300,
  water: 20000, // ml; glass/l checked separately
  steps: 100000,
  sleep: 1440, // minutes; hours checked separately
};

function isIntent(v: unknown): v is Intent {
  return typeof v === 'string' && (INTENTS as readonly string[]).includes(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function qtyOk(intent: Intent, qty: number, unit: ResolverUnit): boolean {
  if (!Number.isFinite(qty) || qty <= 0) return false;
  if (intent === 'exercise' && unit === 'km') return qty <= 300;
  if (intent === 'water' && unit === 'glass') return qty <= 50;
  if (intent === 'water' && unit === 'l') return qty <= 20;
  if (intent === 'sleep' && unit === 'hours') return qty <= 24;
  if (intent === 'weight') return qty >= 20 && qty <= QTY_CAPS.weight;
  return qty <= QTY_CAPS[intent];
}

function unitOk(intent: Intent, unit: string): boolean {
  switch (intent) {
    case 'food':
      return FOOD_UNITS.has(unit);
    case 'exercise':
      return unit === 'minutes' || unit === 'km';
    case 'weight':
      return unit === 'kg'; // lb/lbs already converted before this check
    case 'water':
      return unit === 'glass' || unit === 'ml' || unit === 'l';
    case 'steps':
      return unit === 'steps';
    case 'sleep':
      return unit === 'hours' || unit === 'minutes';
  }
}

function validateOne(candidate: unknown, catalogue: Catalogue): Resolution {
  if (!isRecord(candidate)) return UNRESOLVED;

  const { intent, confidence } = candidate;
  if (!isIntent(intent)) return UNRESOLVED;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return UNRESOLVED;
  if (confidence < CONFIDENCE_FLOOR || confidence > 1) return UNRESOLVED;

  const context = candidate.context === 'outside' ? 'outside' : 'home';

  // Ref: required and catalogue-bound for food/exercise; forced null otherwise.
  let ref: string | null = null;
  if (intent === 'food' || intent === 'exercise') {
    if (typeof candidate.ref !== 'string') return UNRESOLVED;
    const known =
      intent === 'food'
        ? catalogue.dishes.has(candidate.ref) ||
          catalogue.packagedFoods.has(candidate.ref) ||
          catalogue.customDishes.has(candidate.ref)
        : catalogue.exercises.has(candidate.ref);
    if (!known) return UNRESOLVED;
    ref = candidate.ref;
  }

  // Sleep is the one intent allowed to carry no quantity ("slept badly").
  if (intent === 'sleep' && candidate.qty == null) {
    return { intent, ref: null, qty: null, unit: null, context, confidence };
  }

  const rawQty = candidate.qty;
  const rawUnit = candidate.unit;
  if (typeof rawQty !== 'number' || typeof rawUnit !== 'string') return UNRESOLVED;
  let qty: number = rawQty;
  let unit: string = rawUnit;

  // Canonical units are cm/kg/ml/g; the resolver is the input boundary
  // (CLAUDE.md), so imperial body weight converts here and nowhere else.
  if (intent === 'weight' && (unit === 'lb' || unit === 'lbs' || unit === 'pounds')) {
    qty = Math.round(qty * LB_TO_KG * 10) / 10;
    unit = 'kg';
  }

  if (!unitOk(intent, unit)) return UNRESOLVED;
  const resolvedUnit = unit as ResolverUnit;
  if (!qtyOk(intent, qty, resolvedUnit)) return UNRESOLVED;

  return { intent, ref, qty, unit: resolvedUnit, context, confidence };
}

/**
 * The same gate, for a single already-parsed candidate. Cache hits go
 * through here too (security review F2): a poisoned global row or tampered
 * local mirror must clear exactly the bar model output clears.
 */
export function validateResolution(candidate: unknown, catalogue: Catalogue): Resolution {
  return validateOne(candidate, catalogue);
}

/**
 * Strict parse of a raw model reply → one Resolution per candidate entry.
 * No fence stripping, no number regexing (spec/09): if it isn't clean JSON
 * matching the contract, the line is honestly `unresolved`.
 */
export function validateModelOutput(raw: string, catalogue: Catalogue): Resolution[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [UNRESOLVED];
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  if (candidates.length === 0) return [UNRESOLVED];
  return candidates.map((c) => validateOne(c, catalogue));
}
