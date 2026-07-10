// Day composition — pure. Two jobs:
//
// 1. composeDay(rows): what the journal displays — per-line display kind and
//    the running totals. Reads only what is denormalised on the rows.
// 2. recomputeDay(rows, lookups): what the rows should say — food nutrition
//    with the day's oil shares, exercise/steps burns, the steps-vs-ambulatory
//    double-count rule, last-write-wins on steps. Returns patches; the store
//    persists them. Runs at write time, never at render time.
//
// The 1,200 display floor (engine displayNet) is exposed on the totals but
// NOT applied to the running header — spec/02's own mock shows a sub-1,200
// header (790 cals) intraday. FLAG(nirmal): where exactly the floor binds in
// the live journal (vs Stats' day-complete nets) needs a product ruling.

import {
  CALC_VERSION,
  computeEntry,
  dayMovementBurn,
  displayNet,
  metBurn,
  oilShares,
  stepsBurn,
  weightForCalc,
  type Dish,
  type EntryContext,
  type ExerciseBurn,
  type FoodUnit,
  type Kitchen,
} from '../engine';
import type { EntryPatch } from '../db/entriesRepo';
import type { EntryRow, ExerciseRow, PackagedFoodRow } from '../db/rows';

// FLAG(nirmal): spec/05 allows `km` for exercise but spec/06's MET formula
// takes minutes and no spec names a km→minutes conversion. 8 min/km (easy
// jog) used as the engineering default pending a decision.
export const DEFAULT_MIN_PER_KM = 8;

export type LineDisplay =
  | { kind: 'kcal'; value: number } // food — positive, ink
  | { kind: 'burn'; value: number } // counted exercise/steps — negative, muted
  | { kind: 'check' } // water, sleep, weight, sub-3000 steps
  | { kind: 'included' } // ✓ counted elsewhere (double-count rule)
  | { kind: 'pending' } // resolving — shimmer
  | { kind: 'retry' }; // unresolved — ↻

export interface DayLine {
  entry: EntryRow;
  display: LineDisplay;
}

export interface DayTotals {
  consumedKcal: number;
  burnedKcal: number;
  /** consumed − burned, unfloored (see header note above) */
  netKcal: number;
  /** engine displayNet — max(net, 1200); for day-complete surfaces */
  flooredNetKcal: number;
  pendingCount: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  waterMl: number;
}

/** Steps: last write wins (spec/09). Returns the winning row, if any. */
function stepsWinner(rows: readonly EntryRow[]): EntryRow | null {
  const steps = rows.filter(
    (r) => r.intent === 'steps' && r.status === 'resolved' && r.step_count !== null,
  );
  if (steps.length === 0) return null;
  return steps.reduce((latest, r) => (r.created_at >= latest.created_at ? r : latest));
}

export function composeDay(rows: readonly EntryRow[]): { lines: DayLine[]; totals: DayTotals } {
  const winner = stepsWinner(rows);

  let consumed = 0;
  let burned = 0;
  let pending = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  let fiberG = 0;
  let sugarG = 0;
  let waterMl = 0;

  const lines: DayLine[] = rows.map((entry) => {
    if (entry.status === 'resolving') {
      pending += 1;
      return { entry, display: { kind: 'pending' as const } };
    }
    if (entry.status === 'unresolved') {
      pending += 1;
      return { entry, display: { kind: 'retry' as const } };
    }

    switch (entry.intent) {
      case 'food': {
        if (entry.kcal === null) return { entry, display: { kind: 'retry' as const } };
        consumed += entry.kcal;
        proteinG += entry.protein_g ?? 0;
        carbsG += entry.carbs_g ?? 0;
        fatG += entry.fat_g ?? 0;
        fiberG += entry.fiber_g ?? 0;
        sugarG += entry.sugar_g ?? 0;
        return { entry, display: { kind: 'kcal' as const, value: entry.kcal } };
      }
      case 'exercise': {
        if (entry.is_included === 1) return { entry, display: { kind: 'included' as const } };
        const kcal = entry.kcal ?? 0;
        burned += -kcal;
        return { entry, display: { kind: 'burn' as const, value: kcal } };
      }
      case 'steps': {
        if (entry.is_included === 1 || entry.id !== winner?.id) {
          return { entry, display: { kind: 'included' as const } };
        }
        const kcal = entry.kcal ?? 0;
        if (kcal === 0) return { entry, display: { kind: 'check' as const } }; // ✓, never −0
        burned += -kcal;
        return { entry, display: { kind: 'burn' as const, value: kcal } };
      }
      case 'water': {
        waterMl += entry.water_ml ?? 0; // water sums — the one additive intent
        return { entry, display: { kind: 'check' as const } };
      }
      default:
        // weight, sleep — silent ✓ lines
        return { entry, display: { kind: 'check' as const } };
    }
  });

  return {
    lines,
    totals: {
      consumedKcal: consumed,
      burnedKcal: burned,
      netKcal: consumed - burned,
      flooredNetKcal: displayNet(consumed, burned),
      pendingCount: pending,
      proteinG,
      carbsG,
      fatG,
      fiberG,
      sugarG,
      waterMl,
    },
  };
}

// ---------------------------------------------------------------------------
// recompute — write-time nutrition + the double-count rule
// ---------------------------------------------------------------------------

export interface DayLookups {
  dishes: ReadonlyMap<string, Dish>;
  exercises: ReadonlyMap<string, Pick<ExerciseRow, 'met' | 'unit' | 'is_ambulatory'>>;
  packagedFoods: ReadonlyMap<string, PackagedFoodRow>;
}

export interface DayContext {
  kitchen: Kitchen;
  kitchenIsAssumed: boolean;
  weightKg: number | null;
}

function exerciseMinutes(qty: number, unit: string): number {
  return unit === 'km' ? qty * DEFAULT_MIN_PER_KM : qty;
}

function packagedNutrition(row: PackagedFoodRow, qty: number, unit: string): EntryPatch | null {
  const grams =
    unit === 'g' || unit === 'ml' ? qty : unit === 'kg' || unit === 'l' ? qty * 1000 : null;
  if (grams === null || row.kcal_100g === null) return null;
  const f = grams / 100;
  return {
    kcal: row.kcal_100g * f,
    protein_g: (row.protein_100g ?? 0) * f,
    carbs_g: (row.carbs_100g ?? 0) * f,
    fat_g: (row.fat_100g ?? 0) * f,
    fiber_g: (row.fiber_100g ?? 0) * f,
    sugar_g: (row.sugar_100g ?? 0) * f,
  };
}

/**
 * Recompute every derived number on the day's rows. Pure; returns a patch per
 * entry id that needs to change. A resolved food row whose ref has no dish in
 * the mirror degrades to unresolved (retryable — the mirror may just be stale).
 */
export function recomputeDay(
  rows: readonly EntryRow[],
  lookups: DayLookups,
  ctx: DayContext,
): Map<string, EntryPatch> {
  const patches = new Map<string, EntryPatch>();
  const weightKg = weightForCalc({
    weightKg: ctx.weightKg,
    weightIsAssumed: ctx.weightKg === null,
  });

  const resolved = rows.filter((r) => r.status === 'resolved');

  // --- food: oil shares distribute the day's cooking fat (spec/06) ---
  const foods = resolved.filter((r) => r.intent === 'food' && r.resolved_ref !== null);
  const homeCooked = foods.filter((r) => {
    const dish = lookups.dishes.get(r.resolved_ref ?? '');
    return dish?.isHomeCookable === true && r.context !== 'outside';
  });
  const shares = oilShares(
    homeCooked.map((r) => lookups.dishes.get(r.resolved_ref ?? '')?.cookingFatMl ?? null),
  );
  const shareByEntry = new Map(homeCooked.map((r, i) => [r.id, shares[i] ?? 0]));

  for (const row of foods) {
    const ref = row.resolved_ref ?? '';
    const dish = lookups.dishes.get(ref);
    if (dish && row.qty !== null && row.unit !== null) {
      const n = computeEntry({
        resolution: {
          ref,
          qty: row.qty,
          unit: row.unit as FoodUnit,
          context: (row.context ?? 'home') as EntryContext,
        },
        dish,
        oilShare: shareByEntry.get(row.id) ?? 0,
        kitchen: ctx.kitchen,
        personalization: null, // profiles.personalization parsing lands in Phase 5
      });
      patches.set(row.id, {
        kcal: n.kcal,
        protein_g: n.proteinG,
        carbs_g: n.carbsG,
        fat_g: n.fatG,
        fiber_g: n.fiberG,
        sugar_g: n.sugarG,
        was_calibrated:
          dish.isHomeCookable && row.context !== 'outside' && !ctx.kitchenIsAssumed ? 1 : 0,
        calc_version: CALC_VERSION,
      });
      continue;
    }

    const packaged = lookups.packagedFoods.get(ref);
    const fromPackage =
      packaged && row.qty !== null && row.unit !== null
        ? packagedNutrition(packaged, row.qty, row.unit)
        : null;
    if (fromPackage) {
      patches.set(row.id, { ...fromPackage, was_calibrated: 0, calc_version: CALC_VERSION });
      continue;
    }

    // Ref exists in no mirror (stale pull, removed dish): honest, retryable.
    patches.set(row.id, { status: 'unresolved', retryable: 1 });
  }

  // --- exercise: MET burn, stored negative ---
  const exerciseRows = resolved.filter((r) => r.intent === 'exercise' && r.resolved_ref !== null);
  const burns: (ExerciseBurn & { id: string })[] = [];
  for (const row of exerciseRows) {
    const exercise = lookups.exercises.get(row.resolved_ref ?? '');
    if (!exercise || row.qty === null) {
      patches.set(row.id, { status: 'unresolved', retryable: 1 });
      continue;
    }
    const minutes = exerciseMinutes(row.qty, row.unit ?? 'minutes');
    const kcal = metBurn(exercise.met, weightKg, minutes);
    burns.push({ id: row.id, kcal, isAmbulatory: exercise.is_ambulatory === 1 });
  }

  // --- steps: last write wins; losers render ✓ included ---
  const winner = stepsWinner(rows);
  const winnerBurn = winner?.step_count != null ? stepsBurn(winner.step_count, weightKg) : null;

  const movement = dayMovementBurn(
    winnerBurn,
    burns.map(({ kcal, isAmbulatory }) => ({ kcal, isAmbulatory })),
  );

  for (const burn of burns) {
    const included = burn.isAmbulatory && movement.ambulatoryIncluded;
    const prior = patches.get(burn.id) ?? {};
    patches.set(burn.id, {
      ...prior,
      kcal: -burn.kcal,
      is_included: included ? 1 : 0,
      calc_version: CALC_VERSION,
    });
  }

  for (const row of resolved.filter((r) => r.intent === 'steps')) {
    const isWinner = row.id === winner?.id;
    const included = !isWinner || movement.stepsIncluded;
    patches.set(row.id, {
      kcal: isWinner && winnerBurn !== null && winnerBurn > 0 ? -winnerBurn : null,
      is_included: included ? 1 : 0,
      calc_version: CALC_VERSION,
    });
  }

  // Drop patches that change nothing — keeps updated_at/dirty honest.
  for (const [id, patch] of [...patches]) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    const same = (Object.keys(patch) as (keyof EntryPatch)[]).every(
      (k) => (row as unknown as Record<string, unknown>)[k] === patch[k],
    );
    if (same) patches.delete(id);
  }

  return patches;
}
