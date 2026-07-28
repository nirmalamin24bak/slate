import { describe, expect, it } from 'vitest';

import type { Dish, Kitchen } from '../engine/types';
import { metBurn, stepsBurn } from '../engine';
import type { EntryRow } from '../db/rows';
import {
  composeDay,
  MIN_PER_KM_CYCLE,
  MIN_PER_KM_RUN,
  MIN_PER_KM_WALK,
  recomputeDay,
} from './compose';
import { addDays, dayKey, daysBetween, isWithinFreeWindow } from './dates';

const KITCHEN: Kitchen = {
  katoriMl: 200,
  rotiG: 35,
  oilBottleMl: 1000,
  oilBottleDays: 30,
  householdSize: 4,
  chaiSugarTsp: 1,
  chaiMilk: 'toned',
  coffeeSugarTsp: 1,
  coffeeMilk: 'toned',
};

const ROTI: Dish = {
  id: 'dish_roti',
  defaultUnit: 'roti',
  defaultQty: 1,
  isHomeCookable: true,
  cookingFatMl: 2,
  servingG: null,
  ingredients: [
    {
      grams: 35,
      ingredient: {
        id: 'IFCT_WHEAT',
        kcal100g: 320,
        protein100g: 12,
        carbs100g: 64,
        fat100g: 2,
        fiber100g: 11,
        sugar100g: 2,
      },
    },
  ],
};

let seq = 0;
function row(overrides: Partial<EntryRow>): EntryRow {
  seq += 1;
  return {
    id: `e${seq}`,
    user_id: 'u',
    log_date: '2026-07-10',
    position: seq,
    raw_text: 'x',
    nickname: null,
    intent: 'food',
    status: 'resolved',
    resolved_ref: null,
    qty: null,
    unit: null,
    context: null,
    kcal: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    sugar_g: null,
    water_ml: null,
    step_count: null,
    sleep_minutes: null,
    is_included: 0,
    calc_version: 'engine-v1',
    was_calibrated: 0,
    created_at: `2026-07-10T09:00:0${seq % 10}.000Z`,
    updated_at: '2026-07-10T09:00:00.000Z',
    deleted_at: null,
    retryable: 0,
    dirty: 0,
    ...overrides,
  };
}

describe('dates', () => {
  it('formats device-local day keys and does day arithmetic', () => {
    expect(dayKey(new Date(2026, 6, 10, 23, 59))).toBe('2026-07-10');
    expect(addDays('2026-07-10', -1)).toBe('2026-07-09');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-06-10', '2026-07-10')).toBe(30);
  });

  it('free window: 30 days back, never forward', () => {
    expect(isWithinFreeWindow('2026-07-10', '2026-07-10')).toBe(true);
    expect(isWithinFreeWindow('2026-06-10', '2026-07-10')).toBe(true);
    expect(isWithinFreeWindow('2026-06-09', '2026-07-10')).toBe(false);
    expect(isWithinFreeWindow('2026-07-11', '2026-07-10')).toBe(false);
  });

  it('a malformed key yields a real, distant date — never NaN', () => {
    // Day keys come from the device and from synced rows, so a corrupt one is
    // possible. What matters is that arithmetic on it stays finite: a
    // "NaN-NaN-NaN" key would poison every comparison downstream — the
    // scrubber, the streak, the free-window check — and each of those would
    // fail in a different, confusing place.
    //
    // A missing part falls back (`?? 1`), so a truncated key still parses:
    expect(addDays('2026', 0)).toBe('2026-01-01');
    // An empty key does NOT hit the `?? 1970` fallback — ''.split('-') is
    // [''], and Number('') is 0, not undefined. Year 0 is then mapped to 1900
    // by the Date constructor's two-digit-year rule. Wrong, but real and
    // consistent, which is the property the callers need.
    expect(addDays('', 1)).toBe('1900-01-02');
    expect(daysBetween('', '1900-01-11')).toBe(10);
    expect(Number.isFinite(daysBetween('', '2026-07-10'))).toBe(true);
    // and it lands far outside the free window rather than silently inside it
    expect(isWithinFreeWindow('', '2026-07-10')).toBe(false);
  });
});

describe('composeDay — display', () => {
  it('food sums into consumed + macros; water sums; weight/sleep are ✓', () => {
    const { lines, totals } = composeDay([
      row({ intent: 'food', kcal: 220, protein_g: 8, carbs_g: 44, fat_g: 2 }),
      row({ intent: 'food', kcal: 110, protein_g: 2, carbs_g: 12, fat_g: 5 }),
      row({ intent: 'water', water_ml: 750 }),
      row({ intent: 'water', water_ml: 250 }),
      row({ intent: 'weight', qty: 85 }),
      row({ intent: 'sleep', sleep_minutes: 450 }),
    ]);
    expect(totals.consumedKcal).toBe(330);
    expect(totals.proteinG).toBe(10);
    expect(totals.waterMl).toBe(1000); // water is the one additive intent
    expect(lines.map((l) => l.display.kind)).toEqual([
      'kcal',
      'kcal',
      'check',
      'check',
      'check',
      'check',
    ]);
  });

  it('resolving lines shimmer, unresolved lines show retry, both count as pending', () => {
    const { lines, totals } = composeDay([
      row({ status: 'resolving' }),
      row({ status: 'unresolved', retryable: 1 }),
      row({ intent: 'food', kcal: 100 }),
    ]);
    expect(lines[0]?.display.kind).toBe('pending');
    expect(lines[1]?.display.kind).toBe('retry');
    expect(totals.pendingCount).toBe(2);
    expect(totals.consumedKcal).toBe(100); // never a wrong total — only resolved counts
  });

  it('sub-3000 steps show ✓, not −0', () => {
    const { lines, totals } = composeDay([row({ intent: 'steps', step_count: 2000, kcal: null })]);
    expect(lines[0]?.display.kind).toBe('check');
    expect(totals.burnedKcal).toBe(0);
  });

  it('steps last-write-wins: earlier steps line renders included', () => {
    const first = row({
      intent: 'steps',
      step_count: 5000,
      kcal: -90,
      created_at: '2026-07-10T08:00:00.000Z',
    });
    const second = row({
      intent: 'steps',
      step_count: 9000,
      kcal: -270,
      created_at: '2026-07-10T10:00:00.000Z',
    });
    const { lines, totals } = composeDay([first, second]);
    expect(lines[0]?.display.kind).toBe('included');
    expect(lines[1]?.display).toEqual({ kind: 'burn', value: -270 });
    expect(totals.burnedKcal).toBe(270);
  });

  it('included exercise renders ✓ and does not add to burn', () => {
    const { lines, totals } = composeDay([
      row({ intent: 'exercise', kcal: -234, is_included: 1 }),
      row({ intent: 'steps', step_count: 9000, kcal: -328 }),
    ]);
    expect(lines[0]?.display.kind).toBe('included');
    expect(totals.burnedKcal).toBe(328);
  });

  it('net stays unfloored intraday; flooredNetKcal carries the engine floor', () => {
    const { totals } = composeDay([row({ intent: 'food', kcal: 300 })]);
    expect(totals.netKcal).toBe(300);
    expect(totals.flooredNetKcal).toBe(1200);
  });

  it('a heavy exercise day floors the summary figure but stores the true net', () => {
    // 1400 eaten, 900 burned → true net 500; the summary surface (SummaryCard
    // reads flooredNetKcal) can never read below 1,200 (spec/09 Safety).
    const { totals } = composeDay([
      row({ intent: 'food', kcal: 1400 }),
      row({ intent: 'steps', step_count: 20000, kcal: -900 }),
    ]);
    expect(totals.netKcal).toBe(500); // true value, stored/available
    expect(totals.flooredNetKcal).toBe(1200); // what the card shows
  });

  it('resolved food without nutrition (stale mirror) degrades to retry display', () => {
    const { lines } = composeDay([row({ intent: 'food', kcal: null })]);
    expect(lines[0]?.display.kind).toBe('retry');
  });
});

describe('recomputeDay — write-time math', () => {
  const lookups = {
    dishes: new Map([['dish_roti', ROTI]]),
    exercises: new Map([
      ['ex_walk', { met: 3.5, unit: 'minutes' as const, is_ambulatory: 1 }],
      ['ex_weights', { met: 6, unit: 'minutes' as const, is_ambulatory: 0 }],
      ['ex_run_km', { met: 9, unit: 'km' as const, is_ambulatory: 1 }],
      ['ex_walk_km', { met: 3.8, unit: 'km' as const, is_ambulatory: 1 }],
      ['ex_cycle_km', { met: 7, unit: 'km' as const, is_ambulatory: 0 }],
    ]),
    packagedFoods: new Map([
      [
        '890123',
        {
          barcode: '890123',
          name: 'Biscuit',
          kcal_100g: 480,
          protein_100g: 6,
          carbs_100g: 70,
          fat_100g: 18,
          fiber_100g: 2,
          sugar_100g: 24,
        },
      ],
    ]),
  };
  const ctx = { kitchen: KITCHEN, kitchenIsAssumed: false, weightKg: 85, personalization: null };

  it('computes dish nutrition through the engine and marks calibration', () => {
    const food = row({
      intent: 'food',
      resolved_ref: 'dish_roti',
      qty: 2,
      unit: 'roti',
      context: 'home',
      kcal: null,
    });
    const patches = recomputeDay([food], lookups, ctx);
    const patch = patches.get(food.id);
    expect(patch?.kcal).toBeGreaterThan(200); // 70g wheat ≈ 224 + oil share
    expect(patch?.was_calibrated).toBe(1);
    expect(patch?.calc_version).toBe('engine-v1');
  });

  it('9000 steps + 45 min walk = one burn; walk marked included', () => {
    const walk = row({ intent: 'exercise', resolved_ref: 'ex_walk', qty: 45, unit: 'minutes' });
    const steps = row({ intent: 'steps', step_count: 9000, qty: 9000, unit: 'steps' });
    const patches = recomputeDay([walk, steps], lookups, ctx);

    const stepsKcal = stepsBurn(9000, 85);
    const walkKcal = metBurn(3.5, 85, 45);
    expect(stepsKcal).toBeGreaterThan(walkKcal); // steps win at these numbers

    expect(patches.get(steps.id)?.kcal).toBeCloseTo(-stepsKcal, 6);
    expect(patches.get(steps.id)?.is_included).toBe(0);
    expect(patches.get(walk.id)?.is_included).toBe(1);
  });

  it('non-ambulatory exercise adds on top, never included', () => {
    const weights = row({
      intent: 'exercise',
      resolved_ref: 'ex_weights',
      qty: 30,
      unit: 'minutes',
    });
    const steps = row({ intent: 'steps', step_count: 9000, qty: 9000, unit: 'steps' });
    const patches = recomputeDay([weights, steps], lookups, ctx);
    expect(patches.get(weights.id)?.is_included).toBe(0);
    expect(patches.get(weights.id)?.kcal).toBeCloseTo(-metBurn(6, 85, 30), 6);
  });

  it('km exercise converts at a per-mode pace: run 6, walk 12, cycle 3 min/km', () => {
    const run = row({ intent: 'exercise', resolved_ref: 'ex_run_km', qty: 5, unit: 'km' });
    const walk = row({ intent: 'exercise', resolved_ref: 'ex_walk_km', qty: 5, unit: 'km' });
    const cycle = row({ intent: 'exercise', resolved_ref: 'ex_cycle_km', qty: 10, unit: 'km' });
    const patches = recomputeDay([run, walk, cycle], lookups, ctx);
    // ambulatory MET>=5 → run pace; MET<5 → walk pace; non-ambulatory → cycle pace
    expect(patches.get(run.id)?.kcal).toBeCloseTo(-metBurn(9, 85, 5 * MIN_PER_KM_RUN), 6);
    expect(patches.get(walk.id)?.kcal).toBeCloseTo(-metBurn(3.8, 85, 5 * MIN_PER_KM_WALK), 6);
    expect(patches.get(cycle.id)?.kcal).toBeCloseTo(-metBurn(7, 85, 10 * MIN_PER_KM_CYCLE), 6);
  });

  it('chai nutrition comes from the kitchen calibration, scaled by cup count', () => {
    // KITCHEN: 1 tsp sugar, toned milk → chaiKcal = 5 + 35 + 16 = 56 per cup.
    const oneChai = row({ intent: 'food', resolved_ref: 'dish_chai', qty: 1, unit: 'katori' });
    const twoChai = row({ intent: 'food', resolved_ref: 'dish_chai', qty: 2, unit: 'katori' });
    const patches = recomputeDay([oneChai, twoChai], lookups, ctx);
    expect(patches.get(oneChai.id)?.kcal).toBeCloseTo(56, 6);
    expect(patches.get(oneChai.id)?.sugar_g).toBeCloseTo(4, 6); // 1 tsp ≈ 4 g
    expect(patches.get(twoChai.id)?.kcal).toBeCloseTo(112, 6);
    expect(patches.get(oneChai.id)?.was_calibrated).toBe(1);
  });

  it('black no-sugar chai differs from sweet milky chai — calibration is live', () => {
    const chai = row({ intent: 'food', resolved_ref: 'dish_chai', qty: 1, unit: 'katori' });
    const black = { ...ctx, kitchen: { ...KITCHEN, chaiSugarTsp: 0, chaiMilk: 'none' as const } };
    const sweet = { ...ctx, kitchen: { ...KITCHEN, chaiSugarTsp: 2, chaiMilk: 'full' as const } };
    const blackKcal = recomputeDay([chai], lookups, black).get(chai.id)?.kcal ?? 0;
    const sweetKcal = recomputeDay([chai], lookups, sweet).get(chai.id)?.kcal ?? 0;
    expect(blackKcal).toBeCloseTo(5, 6); // tea base only
    expect(sweetKcal).toBeGreaterThan(blackKcal + 40); // milk + 2 sugars
  });

  it('assumed kitchen leaves chai uncalibrated', () => {
    const chai = row({ intent: 'food', resolved_ref: 'dish_chai', qty: 1, unit: 'katori' });
    const patches = recomputeDay([chai], lookups, { ...ctx, kitchenIsAssumed: true });
    expect(patches.get(chai.id)?.was_calibrated).toBe(0);
  });

  it('assumed weight falls back to 65kg so burns never crash', () => {
    const run = row({ intent: 'exercise', resolved_ref: 'ex_walk', qty: 30, unit: 'minutes' });
    const patches = recomputeDay([run], { ...lookups }, { ...ctx, weightKg: null });
    expect(patches.get(run.id)?.kcal).toBeCloseTo(-metBurn(3.5, 65, 30), 6);
  });

  it('packaged foods compute per-100g; dish refs missing from mirrors degrade honestly', () => {
    const biscuit = row({ intent: 'food', resolved_ref: '890123', qty: 50, unit: 'g' });
    const ghost = row({ intent: 'food', resolved_ref: 'dish_ghost', qty: 1, unit: 'katori' });
    const patches = recomputeDay([biscuit, ghost], lookups, ctx);
    expect(patches.get(biscuit.id)?.kcal).toBe(240);
    expect(patches.get(ghost.id)).toEqual({ status: 'unresolved', retryable: 1 });
  });

  it('oil is distributed across home-cooked entries by cooking-fat weight', () => {
    const a = row({
      intent: 'food',
      resolved_ref: 'dish_roti',
      qty: 1,
      unit: 'roti',
      context: 'home',
    });
    const b = row({
      intent: 'food',
      resolved_ref: 'dish_roti',
      qty: 1,
      unit: 'roti',
      context: 'home',
    });
    const patches = recomputeDay([a, b], lookups, ctx);
    // Two identical dishes split the day's oil evenly: identical kcal.
    expect(patches.get(a.id)?.kcal).toBeCloseTo(patches.get(b.id)?.kcal ?? 0, 9);
  });

  it('leaves rows alone when nothing changed', () => {
    const steps = row({
      intent: 'steps',
      step_count: 2000,
      qty: 2000,
      unit: 'steps',
      kcal: null,
      is_included: 0,
      calc_version: 'engine-v1',
    });
    const patches = recomputeDay([steps], lookups, ctx);
    expect(patches.size).toBe(0);
  });

  // Personalization (spec/05) flows profiles.personalization → parsePersonalization
  // → the engine's bounded clamp. recompute wires it in; these prove direction and
  // that the clamp floor holds — the model can lean a dish, never lie about it.
  const homeRoti = () =>
    row({
      intent: 'food',
      resolved_ref: 'dish_roti',
      qty: 2,
      unit: 'roti',
      context: 'home',
      kcal: null,
    });

  // Ingredient-only floor for 2 roti (70g wheat @ 320 kcal/100g), no cooking oil.
  const INGREDIENT_ONLY_KCAL = (320 * 70) / 100; // 224

  it('"very little oil" lowers a home-cooked dish below its unpersonalized kcal', () => {
    const plain = homeRoti();
    const leaner = homeRoti();
    const plainKcal = recomputeDay([plain], lookups, ctx).get(plain.id)?.kcal;
    const leanKcal = recomputeDay([leaner], lookups, {
      ...ctx,
      personalization: 'very little oil',
    }).get(leaner.id)?.kcal;

    expect(plainKcal).toBeDefined();
    expect(leanKcal).toBeDefined();
    // The fat clamp cuts cooking oil, so fewer calories than the same dish plain.
    expect(leanKcal ?? 0).toBeLessThan(plainKcal ?? 0);
    // …but the cut is bounded: oil can shrink, ingredients cannot. Never a lie.
    expect(leanKcal ?? 0).toBeGreaterThan(INGREDIENT_ONLY_KCAL);
  });

  it('the fat clamp bounds the cut: "very little oil" removes at most 30% of cooking oil', () => {
    const plain = homeRoti();
    const leaner = homeRoti();
    const plainKcal = recomputeDay([plain], lookups, ctx).get(plain.id)?.kcal ?? 0;
    const leanKcal =
      recomputeDay([leaner], lookups, {
        ...ctx,
        personalization: 'very little oil',
      }).get(leaner.id)?.kcal ?? 0;

    // Oil in the plain dish is (plainKcal − ingredient floor). The fat factor is
    // clamped to 0.7 (±30%), so no more than 30% of that oil can be removed.
    const plainOilKcal = plainKcal - INGREDIENT_ONLY_KCAL;
    const removed = plainKcal - leanKcal;
    expect(plainOilKcal).toBeGreaterThan(0); // there is oil to cut
    expect(removed).toBeCloseTo(plainOilKcal * 0.3, 6); // exactly the clamp edge
  });

  it('the literal "everything I eat is 50 calories" is not a recognized phrase — no effect', () => {
    // parsePersonalization only moves on cooking-habit phrases; a wish about
    // totals matches nothing and returns null, so the dish is unchanged.
    const plain = homeRoti();
    const wish = homeRoti();
    const plainKcal = recomputeDay([plain], lookups, ctx).get(plain.id)?.kcal;
    const wishKcal = recomputeDay([wish], lookups, {
      ...ctx,
      personalization: 'everything I eat is 50 calories',
    }).get(wish.id)?.kcal;
    expect(wishKcal).toBeCloseTo(plainKcal ?? 0, 9);
  });

  it('a recognized low-cal phrase cannot drop total kcal below the ±20% clamp floor', () => {
    // "low-cal" parses to total 0.7; the engine clamps to 0.8. The recomputed
    // kcal must never fall below 80% of the unpersonalized dish.
    const plain = homeRoti();
    const lean = homeRoti();
    const plainKcal = recomputeDay([plain], lookups, ctx).get(plain.id)?.kcal ?? 0;
    const leanKcal =
      recomputeDay([lean], lookups, { ...ctx, personalization: 'low-cal' }).get(lean.id)?.kcal ?? 0;
    expect(leanKcal).toBeLessThan(plainKcal); // it does lean the dish
    expect(leanKcal).toBeGreaterThanOrEqual(plainKcal * 0.8 - 1e-6); // never past the clamp
  });
});

// Paths that only fire on input the happy-path tests never produce: a barcode
// logged in kilograms, a packaged row with no energy value, a resolved
// exercise the mirror no longer knows, a step count too small to bill. Each is
// something a real journal produces on a bad day, and each one silently
// wrong is a wrong number in someone's budget.
describe('recomputeDay — the degraded and edge inputs', () => {
  const lookups = {
    dishes: new Map([['dish_roti', ROTI]]),
    exercises: new Map([['ex_walk', { met: 3.5, unit: 'minutes' as const, is_ambulatory: 1 }]]),
    packagedFoods: new Map([
      [
        '890123',
        {
          barcode: '890123',
          name: 'Biscuit',
          kcal_100g: 480,
          protein_100g: 6,
          carbs_100g: 70,
          fat_100g: 18,
          fiber_100g: 2,
          sugar_100g: 24,
        },
      ],
      [
        '890999',
        {
          barcode: '890999',
          name: 'Mystery Snack',
          kcal_100g: null,
          protein_100g: null,
          carbs_100g: null,
          fat_100g: null,
          fiber_100g: null,
          sugar_100g: null,
        },
      ],
    ]),
  };
  const ctx = { kitchen: KITCHEN, kitchenIsAssumed: false, weightKg: 85, personalization: null };

  it('a packaged food in kg or litres converts at 1000, not 1', () => {
    const inKg = row({ intent: 'food', resolved_ref: '890123', qty: 0.05, unit: 'kg' });
    const inG = row({ intent: 'food', resolved_ref: '890123', qty: 50, unit: 'g' });
    const patches = recomputeDay([inKg, inG], lookups, ctx);
    expect(patches.get(inKg.id)?.kcal).toBeCloseTo(240, 6);
    expect(patches.get(inKg.id)?.kcal).toBeCloseTo(patches.get(inG.id)?.kcal ?? 0, 6);
  });

  it('a packaged food in a portion unit degrades rather than guessing a weight', () => {
    // A barcode has no recipe, so "1 katori of Britannia" has no gram basis.
    // Guessing one would be a fabricated number (non-negotiable #3).
    const katori = row({ intent: 'food', resolved_ref: '890123', qty: 1, unit: 'katori' });
    expect(recomputeDay([katori], lookups, ctx).get(katori.id)).toEqual({
      status: 'unresolved',
      retryable: 1,
    });
  });

  it('a packaged food with no energy value degrades — never zero calories', () => {
    // Open Food Facts often has a product with no per-100g energy. Zero would
    // read as "this snack is free", which is worse than an honest ↻.
    const mystery = row({ intent: 'food', resolved_ref: '890999', qty: 50, unit: 'g' });
    expect(recomputeDay([mystery], lookups, ctx).get(mystery.id)).toEqual({
      status: 'unresolved',
      retryable: 1,
    });
  });

  it('a food row resolved without a qty degrades instead of computing on null', () => {
    const noQty = row({ intent: 'food', resolved_ref: 'dish_roti', qty: null, unit: 'roti' });
    expect(recomputeDay([noQty], lookups, ctx).get(noQty.id)).toEqual({
      status: 'unresolved',
      retryable: 1,
    });
  });

  it('missing context reads as home — the calibrated path, not the restaurant one', () => {
    const noContext = row({
      intent: 'food',
      resolved_ref: 'dish_roti',
      qty: 2,
      unit: 'roti',
      context: null,
    });
    const atHome = row({
      intent: 'food',
      resolved_ref: 'dish_roti',
      qty: 2,
      unit: 'roti',
      context: 'home',
    });
    const patches = recomputeDay([noContext], lookups, ctx);
    const home = recomputeDay([atHome], lookups, ctx);
    expect(patches.get(noContext.id)?.kcal).toBeCloseTo(home.get(atHome.id)?.kcal ?? 0, 9);
    expect(patches.get(noContext.id)?.was_calibrated).toBe(1);
  });

  it('an assumed kitchen leaves a dish uncalibrated even at home', () => {
    const roti = row({
      intent: 'food',
      resolved_ref: 'dish_roti',
      qty: 2,
      unit: 'roti',
      context: 'home',
    });
    const patches = recomputeDay([roti], lookups, { ...ctx, kitchenIsAssumed: true });
    expect(patches.get(roti.id)?.was_calibrated).toBe(0);
  });

  it('an exercise whose ref left the mirror degrades, and one with no qty too', () => {
    const ghost = row({ intent: 'exercise', resolved_ref: 'ex_gone', qty: 30, unit: 'minutes' });
    const noQty = row({ intent: 'exercise', resolved_ref: 'ex_walk', qty: null, unit: 'minutes' });
    const patches = recomputeDay([ghost, noQty], lookups, ctx);
    expect(patches.get(ghost.id)).toEqual({ status: 'unresolved', retryable: 1 });
    expect(patches.get(noQty.id)).toEqual({ status: 'unresolved', retryable: 1 });
  });

  it('steps under the 3,000 baseline bill nothing, and a stale burn is cleared', () => {
    // baseline = BMR × 1.2 already contains the first ~3,000 steps
    // (non-negotiable #5), so they must not credit a second time. A fresh row
    // already says null/0, so recompute emits no patch at all — that is the
    // no-op drop working, not the rule being skipped.
    const fresh = row({ intent: 'steps', resolved_ref: null, qty: 2500, step_count: 2500 });
    expect(recomputeDay([fresh], lookups, ctx).get(fresh.id)).toBeUndefined();

    // A row carrying a burn from an earlier, larger step count must lose it
    // rather than keep crediting calories the user did not walk.
    const stale = row({
      intent: 'steps',
      resolved_ref: null,
      qty: 2500,
      step_count: 2500,
      kcal: -180,
    });
    const patch = recomputeDay([stale], lookups, ctx).get(stale.id);
    expect(patch?.kcal).toBeNull();
    expect(patch?.is_included).toBe(0); // it is the winner, just worth nothing
  });
});
