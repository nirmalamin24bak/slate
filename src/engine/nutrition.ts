// Nutrition arithmetic over IFCT ingredients. Pure; no rounding here — the UI rounds.

import { OIL_FAT_G_PER_ML, OIL_KCAL_PER_ML } from './constants';
import type { Dish, Nutrition } from './types';
import { portionBasisGrams } from './units';

export function zeroNutrition(): Nutrition {
  return { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0 };
}

/**
 * Nutrition of `grams` of the dish, computed from its recipe's IFCT rows.
 * The recipe defines one default portion; other masses scale linearly against
 * what that portion WEIGHS SERVED (portionBasisGrams), not against the raw
 * ingredient total — for anything cooked from dry those differ by 3–4×.
 */
export function sumIngredients(dish: Dish, grams: number): Nutrition {
  const basis = portionBasisGrams(dish);
  if (basis === 0 || grams === 0) return zeroNutrition();
  const factor = grams / basis;
  return dish.ingredients.reduce((n, di) => {
    const g = di.grams * factor;
    return {
      kcal: n.kcal + (di.ingredient.kcal100g * g) / 100,
      proteinG: n.proteinG + (di.ingredient.protein100g * g) / 100,
      carbsG: n.carbsG + (di.ingredient.carbs100g * g) / 100,
      fatG: n.fatG + (di.ingredient.fat100g * g) / 100,
      fiberG: n.fiberG + ((di.ingredient.fiber100g ?? 0) * g) / 100,
      sugarG: n.sugarG + ((di.ingredient.sugar100g ?? 0) * g) / 100,
    };
  }, zeroNutrition());
}

/** Cooking oil on top of the recipe: 9 kcal and 1 g fat per ml (spec/06 arithmetic). */
export function addOil(n: Nutrition, oilMl: number): Nutrition {
  return {
    ...n,
    kcal: n.kcal + oilMl * OIL_KCAL_PER_ML,
    fatG: n.fatG + oilMl * OIL_FAT_G_PER_ML,
  };
}

/** Uniform multiplier — e.g. the outside-context portion factor. */
export function scale(n: Nutrition, factor: number): Nutrition {
  return {
    kcal: n.kcal * factor,
    proteinG: n.proteinG * factor,
    carbsG: n.carbsG * factor,
    fatG: n.fatG * factor,
    fiberG: n.fiberG * factor,
    sugarG: n.sugarG * factor,
  };
}
