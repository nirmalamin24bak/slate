// The only unit-conversion site in the codebase (CLAUDE.md). Pure; reads kitchen.

import { CUP_ML, GLASS_ML, LITRE_ML, TBSP_ML, TSP_ML } from './constants';
import type { Dish, FoodUnit, Kitchen } from './types';

/** Total raw-ingredient grams of the dish's default portion. */
export function recipeTotalGrams(dish: Dish): number {
  return dish.ingredients.reduce((sum, di) => sum + di.grams, 0);
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
      // scale the recipe: defaultQty units of defaultUnit weigh recipeTotalGrams
      return (qty / dish.defaultQty) * recipeTotalGrams(dish);
  }
}
