import { describe, expect, test } from 'vitest';
import type { Dish, Kitchen } from './types';
import { recipeTotalGrams, toGrams } from './units';

// toGrams is the ONLY unit-conversion site in the codebase (CLAUDE.md).
// It reads kitchen. It is pure. katori → ml → g at 1 g/ml for cooked wet dishes.

const kitchen: Kitchen = {
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

function makeDish(overrides: Partial<Dish> = {}): Dish {
  return {
    id: 'dish_test',
    defaultUnit: 'katori',
    defaultQty: 1,
    isHomeCookable: true,
    cookingFatMl: 5,
    ingredients: [
      { grams: 30, ingredient: ing('a') },
      { grams: 170, ingredient: ing('b') },
    ],
    ...overrides,
  };
}

function ing(id: string) {
  return {
    id,
    kcal100g: 100,
    protein100g: 5,
    carbs100g: 15,
    fat100g: 2,
    fiber100g: 1,
    sugar100g: 0,
  };
}

describe('toGrams', () => {
  test('grams pass through', () => {
    expect(toGrams(150, 'g', makeDish(), kitchen)).toBe(150);
  });

  test('kg → ×1000', () => {
    expect(toGrams(0.5, 'kg', makeDish(), kitchen)).toBe(500);
  });

  test('ml → g at 1:1', () => {
    expect(toGrams(120, 'ml', makeDish(), kitchen)).toBe(120);
  });

  test('litre → ×1000', () => {
    expect(toGrams(1, 'l', makeDish(), kitchen)).toBe(1000);
  });

  test('katori reads the kitchen — same word, different house', () => {
    expect(toGrams(1, 'katori', makeDish(), kitchen)).toBe(200);
    expect(toGrams(2, 'katori', makeDish(), { ...kitchen, katoriMl: 150 })).toBe(300);
  });

  test('roti reads the kitchen — 2 rotis is 50g or 100g depending on the house', () => {
    expect(toGrams(2, 'roti', makeDish(), kitchen)).toBe(70);
    expect(toGrams(2, 'roti', makeDish(), { ...kitchen, rotiG: 50 })).toBe(100);
  });

  test('glass is the Slate constant 250ml, never a kitchen field', () => {
    expect(toGrams(2, 'glass', makeDish(), kitchen)).toBe(500);
  });

  test('tbsp and tsp are standard measures', () => {
    expect(toGrams(2, 'tbsp', makeDish(), kitchen)).toBe(30);
    expect(toGrams(3, 'tsp', makeDish(), kitchen)).toBe(15);
  });

  test('cup uses the 150ml Indian beverage-cup default', () => {
    expect(toGrams(1, 'cup', makeDish(), kitchen)).toBe(150);
  });

  test('piece/plate scale the recipe to the default portion', () => {
    const dosa = makeDish({
      defaultUnit: 'piece',
      defaultQty: 1,
      ingredients: [
        { grams: 45, ingredient: ing('batter') },
        { grams: 5, ingredient: ing('oil') },
      ],
    });
    expect(toGrams(2, 'piece', dosa, kitchen)).toBe(100);

    const biryani = makeDish({
      defaultUnit: 'plate',
      defaultQty: 1,
      ingredients: [{ grams: 350, ingredient: ing('rice') }],
    });
    expect(toGrams(0.5, 'plate', biryani, kitchen)).toBe(175);
  });

  test('piece against a default_qty of 2 halves per-piece grams', () => {
    const idli = makeDish({
      defaultUnit: 'piece',
      defaultQty: 2,
      ingredients: [{ grams: 120, ingredient: ing('batter') }],
    });
    // recipe = 2 idlis = 120g → 3 idlis = 180g
    expect(toGrams(3, 'piece', idli, kitchen)).toBe(180);
  });
});

describe('recipeTotalGrams', () => {
  test('sums the ingredient grams of the default portion', () => {
    expect(recipeTotalGrams(makeDish())).toBe(200);
  });
});
