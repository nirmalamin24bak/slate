// The dish-table gate (spec/06, MASTER "the dish table is not delegable to a
// model"). Every dish in the seed must carry a reviewed kcal band, and its
// recipe — computed through the real engine, over the real IFCT rows in
// 01_ingredients.sql — must land inside it.
//
// What this is and isn't: the band checks the RECIPE, not any one user's
// number. It is the dish's own default portion plus its declared baseline
// cooking fat, with no kitchen calibration, no outside multiplier, and no
// personalization — those are per-user and are tested in the engine's own
// suite. A band failing here means the recipe is wrong, not that a user's day
// is wrong.
//
// The forcing function is the "every dish has a band" assertion: a new dish
// cannot enter the table until someone writes down what it should weigh in at.
// That is the review step, in a file, in a diff — which is exactly what
// MASTER asks for and what a model drafting 400 recipes cannot supply.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { addOil, sumIngredients, toGrams } from '../src/engine';
import type { Dish, FoodUnit, Ingredient, Kitchen } from '../src/engine';

interface DraftDish {
  id: string;
  name: string;
  default_unit: FoodUnit;
  default_qty: number;
  is_home_cookable: boolean;
  cooking_fat_ml: number | null;
  serving_g: number | null;
  ingredients: { ref: string; grams: number }[];
}

const dishes: DraftDish[] = JSON.parse(
  readFileSync(new URL('../supabase/seed/dishes.draft.json', import.meta.url), 'utf8'),
);
const refMap: Record<string, string> = JSON.parse(
  readFileSync(new URL('../scripts/ifct/ref-map.json', import.meta.url), 'utf8'),
);
const bandFile: { meta: Record<string, string>; bands: Record<string, [number, number]> } =
  JSON.parse(readFileSync(new URL('../supabase/seed/dish-bands.json', import.meta.url), 'utf8'));
const bands = bandFile.bands;
const ingredientsSql = readFileSync(
  new URL('../supabase/seed/01_ingredients.sql', import.meta.url),
  'utf8',
);

/**
 * The generated ingredients seed, back into engine rows. Reading the artifact
 * that ships (rather than the CSV it came from) means a botched regeneration
 * fails here too.
 */
function ingredientsFromSql(sql: string): Map<string, Ingredient> {
  const rows = new Map<string, Ingredient>();
  const value = (raw: string): number | null => (raw === 'null' ? null : Number(raw));
  for (const m of sql.matchAll(
    /^\s*\('([A-Za-z0-9_]+)',\s*(?:'(?:[^']|'')*'|null),\s*(?:'(?:[^']|'')*'|null),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+|null),\s*([\d.]+|null)\)/gm,
  )) {
    rows.set(m[1] as string, {
      id: m[1] as string,
      kcal100g: Number(m[2]),
      protein100g: Number(m[3]),
      carbs100g: Number(m[4]),
      fat100g: Number(m[5]),
      fiber100g: value(m[6] as string),
      sugar100g: value(m[7] as string),
    });
  }
  return rows;
}

const ingredients = ingredientsFromSql(ingredientsSql);

// Schema defaults (migration 0001): the median kitchen, so "1 katori" here is
// the same 200 ml the app assumes before anyone answers the kitchen screen.
const MEDIAN_KITCHEN: Kitchen = {
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

function toEngineDish(d: DraftDish): Dish {
  return {
    id: d.id,
    defaultUnit: d.default_unit,
    defaultQty: d.default_qty,
    isHomeCookable: d.is_home_cookable,
    cookingFatMl: d.cooking_fat_ml,
    servingG: d.serving_g,
    ingredients: d.ingredients.map((di) => {
      const ingredient = ingredients.get(refMap[di.ref] as string);
      if (!ingredient) throw new Error(`${d.id}: no ingredient row for "${di.ref}"`);
      return { ingredient, grams: di.grams };
    }),
  };
}

/** kcal of one default portion, recipe + declared baseline fat. No user context. */
function recipeKcal(d: DraftDish): number {
  const dish = toEngineDish(d);
  const grams = toGrams(d.default_qty, d.default_unit, dish, MEDIAN_KITCHEN);
  const n = sumIngredients(dish, grams);
  return addOil(n, d.cooking_fat_ml ?? 0).kcal;
}

describe('dish table — every dish carries a reviewed band', () => {
  it('parses the ingredient rows out of the generated seed', () => {
    // Guards the regex above: if the generator's formatting changes and this
    // silently matches nothing, every band below would pass on zeroes.
    expect(ingredients.size).toBeGreaterThan(500);
    expect(ingredients.get('IFCT_A015')?.kcal100g).toBeCloseTo(356.4, 1); // rice, milled
  });

  it('no dish is in the table without a band, and no band without a dish', () => {
    const dishIds = new Set(dishes.map((d) => d.id));
    const missing = dishes.filter((d) => !bands[d.id]).map((d) => d.id);
    const orphans = Object.keys(bands).filter((id) => !dishIds.has(id));
    expect(missing, 'dishes with no reviewed band — add one to dish-bands.json').toEqual([]);
    expect(orphans, 'bands for dishes that no longer exist').toEqual([]);
  });

  it.each(dishes.map((d) => [d.id, d] as const))('%s lands inside its band', (id, dish) => {
    const band = bands[id];
    if (!band) return; // reported by the assertion above
    const [min, max] = band;
    const kcal = recipeKcal(dish);
    expect(
      kcal,
      `${dish.name}: recipe computes ${kcal.toFixed(0)} kcal per ${dish.default_qty} ${dish.default_unit}, band is ${min}–${max}`,
    ).toBeGreaterThanOrEqual(min);
    expect(kcal).toBeLessThanOrEqual(max);
  });
});
