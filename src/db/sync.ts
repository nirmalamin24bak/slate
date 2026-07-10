// Sync — SQLite is the read source, Supabase is truth (spec/04).
// Push: dirty rows, minus local-only columns. Pull: reference tables
// wholesale (they're small and select-only). Last-write-wins on updated_at;
// a locally-dirty row is never overwritten by a pull.
//
// RemoteDb is a four-method slice of supabase-js so this module tests
// without a network and swaps clients without edits.

import type { SqlAdapter, SqlValue } from './adapter';
import { listDirtyEntries, markEntriesSynced } from './entriesRepo';
import { listDirtyWeights, markWeightsSynced } from './profileRepo';
import {
  replaceDishes,
  replaceExercises,
  replaceIngredients,
  replacePackagedFoods,
} from './referenceRepo';
import type { EntryRow, KitchenRow, ProfileRow, WeightRow } from './rows';

export interface RemoteDb {
  /** upsert rows into a table; throws on error */
  upsert(table: string, rows: readonly Record<string, SqlValue>[]): Promise<void>;
  /** full select of a reference table */
  fetchAll(table: string, columns: string): Promise<Record<string, SqlValue>[]>;
}

/** Local-only columns that must never reach Postgres. */
function stripLocal<T extends { dirty: number }>(
  row: T,
  extra: readonly string[] = [],
): Record<string, SqlValue> {
  const clone: Record<string, SqlValue> = { ...(row as unknown as Record<string, SqlValue>) };
  delete clone['dirty'];
  for (const key of extra) delete clone[key];
  return clone;
}

export async function pushDirty(adapter: SqlAdapter, remote: RemoteDb): Promise<void> {
  const entries = await listDirtyEntries(adapter);
  if (entries.length > 0) {
    await remote.upsert(
      'entries',
      entries.map((e: EntryRow) => stripLocal(e, ['retryable'])),
    );
    await markEntriesSynced(
      adapter,
      entries.map((e) => e.id),
    );
  }

  const weights = await listDirtyWeights(adapter);
  if (weights.length > 0) {
    await remote.upsert(
      'weights',
      weights.map((w: WeightRow) => stripLocal(w)),
    );
    await markWeightsSynced(
      adapter,
      weights.map((w) => w.id),
    );
  }

  const profile = await adapter.get<ProfileRow>('SELECT * FROM profiles WHERE dirty = 1');
  if (profile) {
    await remote.upsert('profiles', [stripLocal(profile)]);
    await adapter.run('UPDATE profiles SET dirty = 0 WHERE user_id = ?', [profile.user_id]);
  }

  const kitchen = await adapter.get<KitchenRow>('SELECT * FROM kitchen WHERE dirty = 1');
  if (kitchen) {
    await remote.upsert('kitchen', [stripLocal(kitchen)]);
    await adapter.run('UPDATE kitchen SET dirty = 0 WHERE user_id = ?', [kitchen.user_id]);
  }
}

/** Refresh the reference mirrors. Called on app start when online; failures are non-fatal. */
export async function pullReference(adapter: SqlAdapter, remote: RemoteDb): Promise<void> {
  const ingredients = await remote.fetchAll(
    'ingredients',
    'id,name,kcal_100g,protein_100g,carbs_100g,fat_100g,fiber_100g,sugar_100g',
  );
  await replaceIngredients(adapter, ingredients);

  const dishes = await remote.fetchAll(
    'dishes',
    'id,name,default_unit,default_qty,is_home_cookable,cooking_fat_ml',
  );
  const dishIngredients = await remote.fetchAll('dish_ingredients', 'dish_id,ingredient_id,grams');
  await replaceDishes(
    adapter,
    dishes.map((d) => ({
      ...d,
      is_home_cookable: d['is_home_cookable'] ? 1 : 0,
    })),
    dishIngredients,
  );

  const exercises = await remote.fetchAll('exercises', 'id,name,met,unit,is_ambulatory');
  await replaceExercises(
    adapter,
    exercises.map((e) => ({ ...e, is_ambulatory: e['is_ambulatory'] ? 1 : 0 })),
  );

  const packaged = await remote.fetchAll(
    'packaged_foods',
    'barcode,brand,name,kcal_100g,protein_100g,carbs_100g,fat_100g,fiber_100g,sugar_100g',
  );
  await replacePackagedFoods(adapter, packaged);
}
