// Kitchen calibration math — the moat (spec/06). Pure; derived values never stored.

import {
  COFFEE_BASE_KCAL,
  DECOCTION_EXTRA_KCAL,
  DECOCTION_MILK_ML,
  MILK_KCAL_PER_60ML,
  MILK_SERVING_ML,
  SUGAR_TSP_G,
  SUGAR_TSP_KCAL,
  TEA_BASE_KCAL,
} from './constants';
import type { Kitchen, MilkKind, Nutrition } from './types';

/** oil_bottle_ml / oil_bottle_days / household_size — checkable against your own kitchen. */
export function dailyOilMlPerPerson(kitchen: Kitchen): number {
  return kitchen.oilBottleMl / kitchen.oilBottleDays / kitchen.householdSize;
}

/**
 * The day's oil is distributed across home-cooked entries proportionally to
 * their base cooking_fat_ml weight. Shares sum to 1 (or all 0 when nothing weighs).
 */
export function oilShares(fatWeights: readonly (number | null)[]): number[] {
  const total = fatWeights.reduce((sum: number, w) => sum + (w ?? 0), 0);
  if (total === 0) return fatWeights.map(() => 0);
  return fatWeights.map((w) => (w ?? 0) / total);
}

function milkKcal(kind: MilkKind, ml: number): number {
  return (MILK_KCAL_PER_60ML[kind] / MILK_SERVING_ML) * ml;
}

/** tea_base + milk(60ml) + sugar_tsp × 16. One sugar + toned ≈ 55 — why Slate exists. */
export function chaiKcal(kitchen: Kitchen): number {
  return (
    TEA_BASE_KCAL +
    milkKcal(kitchen.chaiMilk, MILK_SERVING_ML) +
    kitchen.chaiSugarTsp * SUGAR_TSP_KCAL
  );
}

/** coffee_base + milk + sugar. Decoction: +5 kcal, 100ml milk assumed. */
export function coffeeKcal(kitchen: Kitchen): number {
  const sugar = kitchen.coffeeSugarTsp * SUGAR_TSP_KCAL;
  if (kitchen.coffeeMilk === 'decoction') {
    // FLAG(nirmal): spec says "assume 100ml milk unless specified" without naming
    // the milk type; toned (the schema default) used pending a decision.
    return COFFEE_BASE_KCAL + DECOCTION_EXTRA_KCAL + milkKcal('toned', DECOCTION_MILK_ML) + sugar;
  }
  return COFFEE_BASE_KCAL + milkKcal(kitchen.coffeeMilk, MILK_SERVING_ML) + sugar;
}

// --- beverage nutrition (audit: wire chai/coffee calibration into compute) ---
// The kcal is exact from the calibrated functions above. The tracked macros for
// a beverage are its free sugar (Slate keeps sugar for diabetes; spec/06) and
// the carbs that sugar contributes; milk protein/fat are minor and left at 0
// so a chai never reads as a protein source. Cup-to-cup this is what changes a
// user's day: two sugars vs none.
function sugarMacros(
  sugarTsp: number,
): Pick<Nutrition, 'proteinG' | 'carbsG' | 'fatG' | 'fiberG' | 'sugarG'> {
  const g = sugarTsp * SUGAR_TSP_G;
  return { proteinG: 0, carbsG: g, fatG: 0, fiberG: 0, sugarG: g };
}

export function chaiNutrition(kitchen: Kitchen): Nutrition {
  return { kcal: chaiKcal(kitchen), ...sugarMacros(kitchen.chaiSugarTsp) };
}

export function coffeeNutrition(kitchen: Kitchen): Nutrition {
  return { kcal: coffeeKcal(kitchen), ...sugarMacros(kitchen.coffeeSugarTsp) };
}
