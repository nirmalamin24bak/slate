import { describe, expect, test } from 'vitest';
import { addOil, scale, sumIngredients, zeroNutrition } from './nutrition';
import type { Dish, Ingredient } from './types';

// Dishes are recipes: nutrition always computed from IFCT ingredients (layer 1),
// never hand-typed. Every number has lineage.

const rice: Ingredient = {
  id: 'ifct_rice_flattened',
  kcal100g: 346,
  protein100g: 6.6,
  carbs100g: 77.3,
  fat100g: 1.2,
  fiber100g: 2.0,
  sugar100g: 0.9,
};

const oil: Ingredient = {
  id: 'ifct_oil_sunflower',
  kcal100g: 900,
  protein100g: 0,
  carbs100g: 0,
  fat100g: 100,
  fiber100g: null,
  sugar100g: null,
};

const poha: Dish = {
  id: 'dish_poha',
  defaultUnit: 'katori',
  defaultQty: 1,
  isHomeCookable: true,
  cookingFatMl: 5,
  servingG: null,
  ingredients: [
    { ingredient: rice, grams: 60 },
    { ingredient: oil, grams: 5 },
  ],
};

describe('sumIngredients', () => {
  test('default portion: per-100g values scaled by recipe grams', () => {
    // recipe total 65g; asking for exactly 65g = one default portion
    const n = sumIngredients(poha, 65);
    expect(n.kcal).toBeCloseTo(0.6 * 346 + 0.05 * 900, 6); // 207.6 + 45 = 252.6
    expect(n.proteinG).toBeCloseTo(0.6 * 6.6, 6);
    expect(n.carbsG).toBeCloseTo(0.6 * 77.3, 6);
    expect(n.fatG).toBeCloseTo(0.6 * 1.2 + 0.05 * 100, 6);
    expect(n.fiberG).toBeCloseTo(0.6 * 2.0, 6); // null fiber on oil counts as 0
    expect(n.sugarG).toBeCloseTo(0.6 * 0.9, 6);
  });

  test('half portion scales linearly', () => {
    const full = sumIngredients(poha, 65);
    const half = sumIngredients(poha, 32.5);
    expect(half.kcal).toBeCloseTo(full.kcal / 2, 6);
    expect(half.fatG).toBeCloseTo(full.fatG / 2, 6);
  });

  test('zero grams → zero nutrition', () => {
    expect(sumIngredients(poha, 0)).toEqual(zeroNutrition());
  });

  test('empty recipe → zero nutrition, no divide-by-zero', () => {
    const empty: Dish = { ...poha, ingredients: [] };
    expect(sumIngredients(empty, 200)).toEqual(zeroNutrition());
  });
});

describe('addOil', () => {
  test('oil ml adds 9 kcal and 1 g fat per ml (spec arithmetic: 8.3ml ≈ 75 kcal)', () => {
    const n = addOil(zeroNutrition(), 8.3);
    expect(n.kcal).toBeCloseTo(74.7, 6);
    expect(n.fatG).toBeCloseTo(8.3, 6);
    expect(n.proteinG).toBe(0);
    expect(n.carbsG).toBe(0);
  });

  test('does not mutate its input', () => {
    const base = zeroNutrition();
    addOil(base, 10);
    expect(base.kcal).toBe(0);
  });
});

describe('scale', () => {
  test('multiplies every field — the outside portion multiplier', () => {
    const n = scale({ kcal: 100, proteinG: 10, carbsG: 20, fatG: 5, fiberG: 2, sugarG: 1 }, 1.2);
    expect(n).toEqual({ kcal: 120, proteinG: 12, carbsG: 24, fatG: 6, fiberG: 2.4, sugarG: 1.2 });
  });
});
