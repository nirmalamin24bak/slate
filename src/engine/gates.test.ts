import { describe, expect, test } from 'vitest';
import {
  applyPersonalization,
  bmr,
  computeEntry,
  dayMovementBurn,
  metBurn,
  stepsBurn,
} from './index';
import type { Dish, FoodUnit, Kitchen, PersonalizationFactors } from './types';

// Phase-1 gate tests (build plan): the engine is deterministic — same input,
// same output, forever — and steps + an ambulatory walk are ONE burn, not two.

/** Deterministic LCG so the property test itself is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const UNITS: readonly FoodUnit[] = [
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
];

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  const item = arr[Math.floor(rnd() * arr.length)];
  if (item === undefined) throw new Error('empty pick');
  return item;
}

function randomCase(rnd: () => number) {
  const dish: Dish = {
    id: 'dish_prop',
    defaultUnit: pick(rnd, ['katori', 'plate', 'piece', 'g'] as const),
    defaultQty: 1 + Math.floor(rnd() * 3),
    isHomeCookable: rnd() < 0.7,
    cookingFatMl: rnd() < 0.2 ? null : Math.round(rnd() * 200) / 10,
    servingG: null,
    ingredients: Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({
      grams: 5 + Math.round(rnd() * 3000) / 10,
      ingredient: {
        id: `ifct_${i}`,
        kcal100g: Math.round(rnd() * 9000) / 10,
        protein100g: Math.round(rnd() * 400) / 10,
        carbs100g: Math.round(rnd() * 800) / 10,
        fat100g: Math.round(rnd() * 1000) / 10,
        fiber100g: rnd() < 0.3 ? null : Math.round(rnd() * 100) / 10,
        sugar100g: rnd() < 0.3 ? null : Math.round(rnd() * 300) / 10,
      },
    })),
  };
  const kitchen: Kitchen = {
    katoriMl: pick(rnd, [150, 200, 250] as const),
    rotiG: pick(rnd, [25, 35, 50] as const),
    oilBottleMl: pick(rnd, [500, 1000, 2000] as const),
    oilBottleDays: 10 + Math.floor(rnd() * 50),
    householdSize: 1 + Math.floor(rnd() * 6),
    chaiSugarTsp: Math.floor(rnd() * 4),
    chaiMilk: pick(rnd, ['none', 'toned', 'full'] as const),
    coffeeSugarTsp: Math.floor(rnd() * 4),
    coffeeMilk: pick(rnd, ['none', 'toned', 'full', 'decoction'] as const),
  };
  const personalization: PersonalizationFactors | null =
    rnd() < 0.4
      ? null
      : {
          ...(rnd() < 0.7 ? { total: Math.round(rnd() * 300) / 100 } : {}),
          ...(rnd() < 0.7 ? { fat: Math.round(rnd() * 300) / 100 } : {}),
        };
  return {
    resolution: {
      ref: 'dish_prop',
      qty: Math.round(rnd() * 500) / 100 + 0.25,
      unit: pick(rnd, UNITS),
      context: (rnd() < 0.3 ? 'outside' : 'home') as 'home' | 'outside',
    },
    dish,
    oilShare: Math.round(rnd() * 100) / 100,
    kitchen,
    personalization,
  };
}

describe('gate: determinism', () => {
  test('computeEntry — 1,000 randomized inputs, identical output on repeat', () => {
    const rndA = lcg(42);
    const rndB = lcg(42);
    for (let i = 0; i < 1000; i++) {
      const a = computeEntry(randomCase(rndA));
      const b = computeEntry(randomCase(rndB));
      expect(b).toEqual(a);
      expect(Number.isFinite(a.kcal)).toBe(true);
    }
  });

  test('energy functions — same input, same output over repeated calls', () => {
    const rnd = lcg(7);
    for (let i = 0; i < 1000; i++) {
      const kg = 30 + rnd() * 100;
      const steps = Math.floor(rnd() * 25000);
      const met = 1 + rnd() * 15;
      const minutes = rnd() * 180;
      expect(stepsBurn(steps, kg)).toBe(stepsBurn(steps, kg));
      expect(metBurn(met, kg, minutes)).toBe(metBurn(met, kg, minutes));
      expect(
        bmr({ sex: 'female', weightKg: kg, heightCm: 150 + rnd() * 40, age: 18 }),
      ).not.toBeNaN();
    }
  });

  test('personalization clamp is stable at the bounds', () => {
    const n = { kcal: 100, proteinG: 1, carbsG: 1, fatG: 1, fiberG: 1, sugarG: 1 };
    expect(applyPersonalization(n, { total: 1e9 })).toEqual(
      applyPersonalization(n, { total: 1.2 }),
    );
    expect(applyPersonalization(n, { total: -5 })).toEqual(applyPersonalization(n, { total: 0.8 }));
  });
});

describe('gate: 9000 steps + 45 min walk = one burn', () => {
  test('the day counts max(steps, walk), never the sum', () => {
    const weightKg = 85;
    const steps = stepsBurn(9000, weightKg); // ≈ 327.86
    const walk = metBurn(3.5, weightKg, 45); // ≈ 234.28 (Compendium walking ~3.5 MET)

    const day = dayMovementBurn(steps, [{ kcal: walk, isAmbulatory: true }]);

    expect(day.total).toBe(Math.max(steps, walk));
    expect(day.total).toBeLessThan(steps + walk); // the sum is the bug
    expect(day.ambulatoryIncluded).toBe(true); // walk line renders ✓ included
    expect(day.stepsIncluded).toBe(false);
  });

  test('same day plus weights: only the non-ambulatory burn adds on top', () => {
    const weightKg = 85;
    const steps = stepsBurn(9000, weightKg);
    const walk = metBurn(3.5, weightKg, 45);
    const weightsSession = metBurn(6, weightKg, 30);

    const day = dayMovementBurn(steps, [
      { kcal: walk, isAmbulatory: true },
      { kcal: weightsSession, isAmbulatory: false },
    ]);

    expect(day.total).toBeCloseTo(Math.max(steps, walk) + weightsSession, 8);
  });
});
