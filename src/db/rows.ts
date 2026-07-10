// Row shapes as they come off SQLite (snake_case, ints for booleans) plus
// the mapping into engine/resolver camelCase types. The engine never sees a
// raw row (src/engine/types.ts contract).

import type {
  Dish,
  DishIngredient,
  Ingredient,
  Kitchen,
  MilkKind,
  FoodUnit,
} from '../engine/types';
import type { Intent, ResolverUnit } from '../resolver/types';

export type EntryStatus = 'resolving' | 'resolved' | 'unresolved';

export interface EntryRow {
  id: string;
  user_id: string;
  log_date: string;
  position: number;
  raw_text: string;
  nickname: string | null;
  intent: Intent | 'unresolved';
  status: EntryStatus;
  resolved_ref: string | null;
  qty: number | null;
  unit: ResolverUnit | null;
  context: 'home' | 'outside' | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  water_ml: number | null;
  step_count: number | null;
  sleep_minutes: number | null;
  is_included: number;
  calc_version: string;
  was_calibrated: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  retryable: number;
  dirty: number;
}

export interface WeightRow {
  id: string;
  user_id: string;
  log_date: string;
  weight_kg: number;
  source: 'journal' | 'health' | 'onboarding';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
}

export interface ProfileRow {
  user_id: string;
  dob: string | null;
  sex: 'male' | 'female' | null;
  height_cm: number | null;
  weight_kg: number | null;
  weight_is_assumed: number;
  calorie_goal: number | null;
  protein_goal_g: number | null;
  carbs_goal_g: number | null;
  fat_goal_g: number | null;
  unit_height: 'cm' | 'ftin';
  hide_calories: number;
  show_macros: number;
  show_fiber_sugar: number;
  show_exercise: number;
  show_weight: number;
  show_water: number;
  show_steps: number;
  show_sleep: number;
  personalization: string | null;
  created_at: string;
  updated_at: string;
  dirty: number;
}

export interface KitchenRow {
  user_id: string;
  katori_ml: number;
  roti_g: number;
  oil_bottle_ml: number;
  oil_bottle_days: number;
  household_size: number;
  chai_sugar_tsp: number;
  chai_milk: MilkKind;
  coffee_sugar_tsp: number;
  coffee_milk: MilkKind | 'decoction';
  is_assumed: number;
  created_at: string;
  updated_at: string;
  dirty: number;
}

export interface DishRowJoined {
  id: string;
  default_unit: string;
  default_qty: number;
  is_home_cookable: number;
  cooking_fat_ml: number | null;
}

export interface DishIngredientJoined {
  grams: number;
  id: string;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fiber_100g: number | null;
  sugar_100g: number | null;
}

export interface ExerciseRow {
  id: string;
  name: string;
  met: number;
  unit: 'minutes' | 'km';
  is_ambulatory: number;
}

export interface PackagedFoodRow {
  barcode: string;
  name: string | null;
  kcal_100g: number | null;
  protein_100g: number | null;
  carbs_100g: number | null;
  fat_100g: number | null;
  fiber_100g: number | null;
  sugar_100g: number | null;
}

export function toKitchen(row: KitchenRow): Kitchen {
  return {
    katoriMl: row.katori_ml,
    rotiG: row.roti_g,
    oilBottleMl: row.oil_bottle_ml,
    oilBottleDays: row.oil_bottle_days,
    householdSize: row.household_size,
    chaiSugarTsp: row.chai_sugar_tsp,
    chaiMilk: row.chai_milk,
    coffeeSugarTsp: row.coffee_sugar_tsp,
    coffeeMilk: row.coffee_milk,
  };
}

export function toDish(dish: DishRowJoined, ingredients: readonly DishIngredientJoined[]): Dish {
  const mapped: DishIngredient[] = ingredients.map((r) => {
    const ingredient: Ingredient = {
      id: r.id,
      kcal100g: r.kcal_100g,
      protein100g: r.protein_100g,
      carbs100g: r.carbs_100g,
      fat100g: r.fat_100g,
      fiber100g: r.fiber_100g,
      sugar100g: r.sugar_100g,
    };
    return { ingredient, grams: r.grams };
  });
  return {
    id: dish.id,
    defaultUnit: dish.default_unit as FoodUnit,
    defaultQty: dish.default_qty,
    isHomeCookable: dish.is_home_cookable === 1,
    cookingFatMl: dish.cooking_fat_ml,
    ingredients: mapped,
  };
}
