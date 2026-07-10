import { describe, expect, test } from 'vitest';
import { computeEntry } from './computeEntry';
import type { Dish, Ingredient, Kitchen } from './types';

// Integration of the whole spec/06 computation: toGrams → sumIngredients →
// oil (calibrated at home, ×1.35 outside) → outside portion ×1.20 → clamp.

const rice: Ingredient = {
  id: 'ifct_rice_flattened',
  kcal100g: 346,
  protein100g: 6.6,
  carbs100g: 77.3,
  fat100g: 1.2,
  fiber100g: 2.0,
  sugar100g: 0.9,
};

// Engine convention: home-cookable recipes exclude cooking oil — it enters via
// cooking_fat_ml ("baseline, overridden by calibration", spec/04) through addOil.
const poha: Dish = {
  id: 'dish_poha',
  defaultUnit: 'katori',
  defaultQty: 1,
  isHomeCookable: true,
  cookingFatMl: 5,
  ingredients: [{ ingredient: rice, grams: 60 }],
};

const banana: Dish = {
  id: 'dish_banana',
  defaultUnit: 'piece',
  defaultQty: 1,
  isHomeCookable: false,
  cookingFatMl: null,
  ingredients: [
    {
      grams: 100,
      ingredient: {
        id: 'ifct_banana',
        kcal100g: 110,
        protein100g: 1.2,
        carbs100g: 27,
        fat100g: 0.3,
        fiber100g: 2.6,
        sugar100g: 14,
      },
    },
  ],
};

const kitchen: Kitchen = {
  katoriMl: 200,
  rotiG: 35,
  oilBottleMl: 1000, // → 8.333… ml oil/person/day
  oilBottleDays: 30,
  householdSize: 4,
  chaiSugarTsp: 1,
  chaiMilk: 'toned',
  coffeeSugarTsp: 1,
  coffeeMilk: 'toned',
};

describe('computeEntry — home', () => {
  test('katori of poha: recipe scaled to kitchen katori + calibrated oil share', () => {
    const n = computeEntry({
      resolution: { ref: 'dish_poha', qty: 1, unit: 'katori', context: 'home' },
      dish: poha,
      oilShare: 1,
      kitchen,
      personalization: null,
    });
    // 200g of a 60g recipe → rice ×(200/60); oil = 8.333… ml × share 1 → 75 kcal
    expect(n.kcal).toBeCloseTo(692 + 75, 4);
    expect(n.fatG).toBeCloseTo(2.4 + 8.333333, 4);
    expect(n.proteinG).toBeCloseTo(13.2, 4); // 6.6 g/100g × 200 g
  });

  test('oil share splits across the day’s home-cooked entries', () => {
    const n = computeEntry({
      resolution: { ref: 'dish_poha', qty: 1, unit: 'katori', context: 'home' },
      dish: poha,
      oilShare: 0.25,
      kitchen,
      personalization: null,
    });
    expect(n.kcal).toBeCloseTo(692 + 75 / 4, 4);
  });

  test('personalization fat factor thins the cooking oil, clamped to ±30%', () => {
    const n = computeEntry({
      resolution: { ref: 'dish_poha', qty: 1, unit: 'katori', context: 'home' },
      dish: poha,
      oilShare: 1,
      kitchen,
      personalization: { fat: 0.5 }, // clamps to 0.7
    });
    expect(n.kcal).toBeCloseTo(692 + 75 * 0.7, 4);
  });

  test('personalization total factor scales the final result, clamped to ±20%', () => {
    const n = computeEntry({
      resolution: { ref: 'dish_poha', qty: 1, unit: 'katori', context: 'home' },
      dish: poha,
      oilShare: 1,
      kitchen,
      personalization: { total: 0.9 },
    });
    expect(n.kcal).toBeCloseTo((692 + 75) * 0.9, 4);
  });
});

describe('computeEntry — outside', () => {
  test('restaurant: baseline fat ×1.35, portion ×1.20, kitchen calibration ignored', () => {
    const n = computeEntry({
      resolution: { ref: 'dish_poha', qty: 1, unit: 'katori', context: 'outside' },
      dish: poha,
      oilShare: 1, // must be ignored — it's not your kitchen
      kitchen,
      personalization: null,
    });
    // oil = 5 × 1.35 = 6.75 ml → 60.75 kcal; then everything × 1.20
    expect(n.kcal).toBeCloseTo((692 + 60.75) * 1.2, 4);
    expect(n.fatG).toBeCloseTo((2.4 + 6.75) * 1.2, 4);
  });

  test('personalization fat factor does not apply outside — not your cooking', () => {
    const n = computeEntry({
      resolution: { ref: 'dish_poha', qty: 1, unit: 'katori', context: 'outside' },
      dish: poha,
      oilShare: 1,
      kitchen,
      personalization: { fat: 0.7 },
    });
    expect(n.kcal).toBeCloseTo((692 + 60.75) * 1.2, 4);
  });

  test('home-cookable dish with no baseline fat gets no phantom oil outside', () => {
    const dryDish: Dish = { ...poha, cookingFatMl: null };
    const n = computeEntry({
      resolution: { ref: 'dish_poha', qty: 1, unit: 'katori', context: 'outside' },
      dish: dryDish,
      oilShare: 0,
      kitchen,
      personalization: null,
    });
    expect(n.kcal).toBeCloseTo(692 * 1.2, 4);
  });
});

describe('computeEntry — not home-cookable', () => {
  test('no oil is ever added; calibration does not apply', () => {
    const n = computeEntry({
      resolution: { ref: 'dish_banana', qty: 1, unit: 'piece', context: 'home' },
      dish: banana,
      oilShare: 1,
      kitchen,
      personalization: null,
    });
    expect(n.kcal).toBeCloseTo(110, 6);
    expect(n.fatG).toBeCloseTo(0.3, 6);
  });

  test('outside portion multiplier still applies (restaurant portions run larger)', () => {
    const n = computeEntry({
      resolution: { ref: 'dish_banana', qty: 1, unit: 'piece', context: 'outside' },
      dish: banana,
      oilShare: 0,
      kitchen,
      personalization: null,
    });
    expect(n.kcal).toBeCloseTo(132, 6);
  });
});
