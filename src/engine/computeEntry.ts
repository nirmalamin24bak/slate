// The spec/06 computation, end to end. Pure: the caller supplies the dish row
// and the day-level oil share; the engine never touches a database.

import { OUTSIDE_FAT_MULTIPLIER, OUTSIDE_PORTION_MULTIPLIER } from './constants';
import { dailyOilMlPerPerson } from './kitchen';
import { addOil, scale, sumIngredients } from './nutrition';
import { applyPersonalization, clampFatFactor } from './personalization';
import type { Dish, FoodResolution, Kitchen, Nutrition, PersonalizationFactors } from './types';
import { toGrams } from './units';

export interface ComputeEntryInput {
  resolution: FoodResolution;
  dish: Dish;
  /** from oilShares() over the day's home-cooked entries; ignored outside */
  oilShare: number;
  kitchen: Kitchen;
  personalization: PersonalizationFactors | null;
}

export function computeEntry({
  resolution,
  dish,
  oilShare,
  kitchen,
  personalization,
}: ComputeEntryInput): Nutrition {
  const grams = toGrams(resolution.qty, resolution.unit, dish, kitchen);
  let n = sumIngredients(dish, grams);

  if (dish.isHomeCookable) {
    if (resolution.context === 'outside') {
      // not your kitchen: baseline fat × 1.35, calibration and fat-personalization off
      n = addOil(n, (dish.cookingFatMl ?? 0) * OUTSIDE_FAT_MULTIPLIER);
    } else {
      const fatFactor =
        personalization?.fat === undefined ? 1 : clampFatFactor(personalization.fat);
      n = addOil(n, dailyOilMlPerPerson(kitchen) * oilShare * fatFactor);
    }
  }

  if (resolution.context === 'outside') n = scale(n, OUTSIDE_PORTION_MULTIPLIER);

  return applyPersonalization(n, personalization);
}
