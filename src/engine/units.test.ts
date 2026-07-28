import { describe, expect, test } from 'vitest';
import type { Dish, Kitchen } from './types';
import { sumIngredients } from './nutrition';
import { portionBasisGrams, recipeTotalGrams, toGrams } from './units';

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
    servingG: null,
    ingredients: [
      { grams: 30, ingredient: ing('a') },
      { grams: 170, ingredient: ing('b') },
    ],
    ...overrides,
  };
}

function ing(id: string, kcal100g = 100) {
  return {
    id,
    kcal100g,
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

// The raw-vs-served bug, pinned. Recipes are written on the raw basis — 30 g of
// toor dal, 50 g of rice — because that is the lineage worth keeping. What
// arrives in the katori is 200 ml of cooked food. Scaling the second against
// the first multiplied every wet dish by three or four: one katori of plain
// rice computed as 713 kcal, one of toor dal as 454, against spec/06's stated
// 100–150 for a katori of dal. servingG is the served weight; the recipe total
// is only the fallback for things whose ingredients are already the thing on
// the plate.
describe('portionBasisGrams — raw recipe vs served portion', () => {
  test('falls back to the recipe total when serving weight is not declared', () => {
    expect(portionBasisGrams(makeDish({ servingG: null }))).toBe(200);
  });

  test('a declared serving weight wins over the recipe total', () => {
    const dal = makeDish({
      servingG: 200,
      ingredients: [{ grams: 45, ingredient: ing('toor') }],
    });
    expect(portionBasisGrams(dal)).toBe(200);
  });

  test('one katori of a cooked-from-dry dish is one portion, not four', () => {
    // 45 g of raw ingredients that serve as a 200 ml katori.
    const dal = makeDish({
      defaultUnit: 'katori',
      defaultQty: 1,
      servingG: 200,
      cookingFatMl: null,
      ingredients: [{ grams: 45, ingredient: ing('toor', 335) }],
    });
    const grams = toGrams(1, 'katori', dal, kitchen); // 200 g served
    expect(grams).toBe(200);
    // 45 g of toor at 335 kcal/100g — the raw basis, unscaled
    expect(sumIngredients(dal, grams).kcal).toBeCloseTo(150.75, 2);
  });

  test('a bigger katori still scales the portion up', () => {
    const dal = makeDish({
      defaultUnit: 'katori',
      servingG: 200,
      ingredients: [{ grams: 45, ingredient: ing('toor', 335) }],
    });
    const large = { ...kitchen, katoriMl: 250 };
    const kcal = sumIngredients(dal, toGrams(1, 'katori', dal, large)).kcal;
    expect(kcal).toBeCloseTo(150.75 * 1.25, 2); // 250/200
  });

  test('countable units cancel: a piece is a piece whichever basis is used', () => {
    const withServing = makeDish({
      defaultUnit: 'piece',
      defaultQty: 1,
      servingG: 30,
      ingredients: [{ grams: 25, ingredient: ing('atta', 320) }],
    });
    const withoutServing = { ...withServing, servingG: null };
    const a = sumIngredients(withServing, toGrams(2, 'piece', withServing, kitchen)).kcal;
    const b = sumIngredients(withoutServing, toGrams(2, 'piece', withoutServing, kitchen)).kcal;
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeCloseTo(160, 6); // two rotis of 25 g atta
  });
});
