// Reference mirrors — dishes, ingredients, exercises, packaged foods pulled
// from Supabase (select-only there, read-only here). The resolver's catalogue
// and the engine's dish rows both come from these tables.

import type { Catalogue } from '../resolver/types';
import type { Dish } from '../engine/types';
import type { SqlAdapter, SqlValue } from './adapter';
import { runTransaction } from './adapter';
import type { DishIngredientJoined, DishRowJoined, ExerciseRow, PackagedFoodRow } from './rows';
import { toDish } from './rows';

/** Replace a mirror table wholesale — reference pulls are small and atomic. */
async function replaceRows(
  adapter: SqlAdapter,
  table: string,
  columns: readonly string[],
  rows: readonly Record<string, SqlValue>[],
): Promise<void> {
  await runTransaction(adapter, async () => {
    await adapter.run(`DELETE FROM ${table}`);
    const placeholders = columns.map(() => '?').join(',');
    for (const row of rows) {
      await adapter.run(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`,
        columns.map((c) => row[c] ?? null),
      );
    }
  });
}

export async function replaceIngredients(
  adapter: SqlAdapter,
  rows: readonly Record<string, SqlValue>[],
): Promise<void> {
  await replaceRows(
    adapter,
    'ingredients',
    [
      'id',
      'name',
      'kcal_100g',
      'protein_100g',
      'carbs_100g',
      'fat_100g',
      'fiber_100g',
      'sugar_100g',
    ],
    rows,
  );
}

export async function replaceDishes(
  adapter: SqlAdapter,
  dishes: readonly Record<string, SqlValue>[],
  dishIngredients: readonly Record<string, SqlValue>[],
): Promise<void> {
  await replaceRows(
    adapter,
    'dishes',
    ['id', 'name', 'default_unit', 'default_qty', 'is_home_cookable', 'cooking_fat_ml'],
    dishes,
  );
  await replaceRows(
    adapter,
    'dish_ingredients',
    ['dish_id', 'ingredient_id', 'grams'],
    dishIngredients,
  );
}

export async function replaceExercises(
  adapter: SqlAdapter,
  rows: readonly Record<string, SqlValue>[],
): Promise<void> {
  await replaceRows(adapter, 'exercises', ['id', 'name', 'met', 'unit', 'is_ambulatory'], rows);
}

export async function replacePackagedFoods(
  adapter: SqlAdapter,
  rows: readonly Record<string, SqlValue>[],
): Promise<void> {
  await replaceRows(
    adapter,
    'packaged_foods',
    [
      'barcode',
      'brand',
      'name',
      'kcal_100g',
      'protein_100g',
      'carbs_100g',
      'fat_100g',
      'fiber_100g',
      'sugar_100g',
    ],
    rows,
  );
}

/** Id sets the resolver validates refs against. customDishes lands in Phase 5. */
export async function loadCatalogue(adapter: SqlAdapter): Promise<Catalogue> {
  const dishIds = await adapter.all<{ id: string }>('SELECT id FROM dishes');
  const exerciseIds = await adapter.all<{ id: string }>('SELECT id FROM exercises');
  const barcodes = await adapter.all<{ barcode: string }>('SELECT barcode FROM packaged_foods');
  return {
    dishes: new Set(dishIds.map((r) => r.id)),
    exercises: new Set(exerciseIds.map((r) => r.id)),
    packagedFoods: new Set(barcodes.map((r) => r.barcode)),
    customDishes: new Set<string>(),
  };
}

export async function loadDish(adapter: SqlAdapter, dishId: string): Promise<Dish | null> {
  const dish = await adapter.get<DishRowJoined>(
    'SELECT id, default_unit, default_qty, is_home_cookable, cooking_fat_ml FROM dishes WHERE id = ?',
    [dishId],
  );
  if (!dish) return null;
  const ingredients = await adapter.all<DishIngredientJoined>(
    `SELECT di.grams, i.id, i.kcal_100g, i.protein_100g, i.carbs_100g, i.fat_100g, i.fiber_100g, i.sugar_100g
     FROM dish_ingredients di JOIN ingredients i ON i.id = di.ingredient_id
     WHERE di.dish_id = ?`,
    [dishId],
  );
  return toDish(dish, ingredients);
}

export async function getExercise(adapter: SqlAdapter, id: string): Promise<ExerciseRow | null> {
  return adapter.get<ExerciseRow>('SELECT * FROM exercises WHERE id = ?', [id]);
}

export async function getPackagedFood(
  adapter: SqlAdapter,
  barcode: string,
): Promise<PackagedFoodRow | null> {
  return adapter.get<PackagedFoodRow>('SELECT * FROM packaged_foods WHERE barcode = ?', [barcode]);
}
