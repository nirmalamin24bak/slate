// The only unit-conversion site in the codebase (CLAUDE.md). Pure; reads kitchen.

import { CUP_ML, GLASS_ML, LITRE_ML, TBSP_ML, TSP_ML } from './constants';
import type { Dish, FoodUnit, Kitchen } from './types';

/** Total raw-ingredient grams of the dish's default portion. */
export function recipeTotalGrams(dish: Dish): number {
  return dish.ingredients.reduce((sum, di) => sum + di.grams, 0);
}

/**
 * What one default portion WEIGHS when served — the denominator every scaling
 * decision divides by.
 *
 * This is not the same number as the recipe total, and conflating them was a
 * real bug: dal is written as 30 g of raw toor because that is the honest
 * lineage, but the katori it arrives in holds 200 ml. Scaling 200 g of served
 * dal against a 45 g recipe basis multiplied every wet dish by four — one
 * katori of plain rice computed as 713 kcal against spec/06's 100–150 for dal.
 *
 * `servingG` carries the served weight where it differs. Where it doesn't (a
 * banana, a roti, a piece of dhokla — things whose ingredients ARE the thing
 * on the plate) it is null and the recipe total stands.
 */
export function portionBasisGrams(dish: Dish): number {
  return dish.servingG ?? recipeTotalGrams(dish);
}

/**
 * qty + unit → grams. Volume units convert at 1 g/ml — cooked wet dishes sit
 * near water density and ±20% is the stated accuracy target (spec/06).
 */
export function toGrams(qty: number, unit: FoodUnit, dish: Dish, kitchen: Kitchen): number {
  switch (unit) {
    case 'g':
      return qty;
    case 'kg':
      return qty * 1000;
    case 'ml':
      return qty;
    case 'l':
      return qty * LITRE_ML;
    case 'katori':
      return qty * kitchen.katoriMl;
    case 'roti':
      return qty * kitchen.rotiG;
    case 'glass':
      return qty * GLASS_ML;
    case 'cup':
      return qty * CUP_ML;
    case 'tbsp':
      return qty * TBSP_ML;
    case 'tsp':
      return qty * TSP_ML;
    case 'piece':
    case 'plate':
      // countable units: defaultQty of them weigh one portion basis
      return (qty / dish.defaultQty) * portionBasisGrams(dish);
  }
}
