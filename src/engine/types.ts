// Engine-internal types — camelCase mirrors of spec/04 rows. The db layer maps
// snake_case ↔ these; the engine never sees a raw row.

/** Mass/volume units the resolver may emit for food (spec/05 vocabulary). */
export type FoodUnit =
  | 'katori'
  | 'plate'
  | 'glass'
  | 'cup'
  | 'piece'
  | 'roti'
  | 'tbsp'
  | 'tsp'
  | 'g'
  | 'ml'
  | 'kg'
  | 'l';

export interface Nutrition {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
}

/** IFCT 2017 row, per 100g. */
export interface Ingredient {
  id: string;
  kcal100g: number;
  protein100g: number;
  carbs100g: number;
  fat100g: number;
  fiber100g: number | null;
  sugar100g: number | null;
}

export interface DishIngredient {
  ingredient: Ingredient;
  /** grams of this ingredient in the dish's default portion */
  grams: number;
}

export interface Dish {
  id: string;
  defaultUnit: FoodUnit;
  defaultQty: number;
  isHomeCookable: boolean;
  /** baseline cooking fat for the default portion; overridden by calibration */
  cookingFatMl: number | null;
  ingredients: readonly DishIngredient[];
}

export type MilkKind = 'none' | 'toned' | 'full';

export interface Kitchen {
  katoriMl: number;
  rotiG: number;
  oilBottleMl: number;
  oilBottleDays: number;
  householdSize: number;
  chaiSugarTsp: number;
  chaiMilk: MilkKind;
  coffeeSugarTsp: number;
  coffeeMilk: MilkKind | 'decoction';
}

export type EntryContext = 'home' | 'outside';

/** The slice of a resolver Resolution the engine consumes (spec/05). */
export interface FoodResolution {
  ref: string;
  qty: number;
  unit: FoodUnit;
  context: EntryContext;
}

/**
 * Bounded modifiers derived from profiles.personalization free text (spec/05).
 * The engine clamps them; the model cannot be argued past the clamp.
 */
export interface PersonalizationFactors {
  /** multiplier on final kcal, clamped to ±20% */
  total?: number;
  /** multiplier on cooking fat ml, clamped to ±30% */
  fat?: number;
}
