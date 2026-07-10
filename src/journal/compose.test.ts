import { describe, expect, it } from 'vitest';

import type { Dish, Kitchen } from '../engine/types';
import { metBurn, stepsBurn } from '../engine';
import type { EntryRow } from '../db/rows';
import { composeDay, DEFAULT_MIN_PER_KM, recomputeDay } from './compose';
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
  const ctx = { kitchen: KITCHEN, kitchenIsAssumed: false, weightKg: 85 };

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

  it('km exercise converts via the flagged default pace', () => {
    const run = row({ intent: 'exercise', resolved_ref: 'ex_run_km', qty: 5, unit: 'km' });
    const patches = recomputeDay([run], lookups, ctx);
    expect(patches.get(run.id)?.kcal).toBeCloseTo(-metBurn(9, 85, 5 * DEFAULT_MIN_PER_KM), 6);
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
});
