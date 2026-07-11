// Sync — SQLite is the read source, Supabase is truth (spec/04).
// Push: dirty rows, minus local-only columns, cleared under an updated_at
// guard. Pull (reference): the mirror tables wholesale. Pull (user data):
// entries/weights/profile/kitchen merged last-write-wins on updated_at, and a
// locally-dirty row is never overwritten by a pull.
//
// RemoteDb is a slice of supabase-js so this module tests without a network
// and swaps clients without edits.

import type { SqlAdapter, SqlValue } from './adapter';
import { listDirtyEntries, markEntriesSynced, pullMergeEntries } from './entriesRepo';
import {
  listDirtyWeights,
  markWeightsSynced,
  pullMergeKitchen,
  pullMergeProfile,
  pullMergeWeights,
} from './profileRepo';
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
  /** select one user's rows from a user-owned table, paged internally */
  fetchOwned(table: string, userId: string): Promise<Record<string, SqlValue>[]>;
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

/**
 * Push dirty rows to Supabase. `ownerId` scopes the push to one user's rows;
 * placeholder-owned rows (offline install, pre-adoption) are never pushed —
 * they'd fail RLS or land mis-owned. The guard lives here, not only in the
 * caller, so no future caller can lose it (security review, defense-in-depth).
 * Omitting `ownerId` pushes every dirty row (tests, single-user scripts).
 */
export async function pushDirty(
  adapter: SqlAdapter,
  remote: RemoteDb,
  ownerId?: string,
): Promise<void> {
  const owns = (row: { user_id: string }) => ownerId === undefined || row.user_id === ownerId;

  // Each table: read the dirty snapshot (with updated_at), push over the
  // network, then clear dirty guarded by that same updated_at. The network
  // call cannot live inside a SQLite transaction, so ordering carries the
  // safety: a crash after the upsert but before the mark leaves the row dirty
  // and re-pushes it (the server upsert is idempotent), and an edit that races
  // in between bumps updated_at so the guarded mark skips it — no lost write.
  const entries = (await listDirtyEntries(adapter)).filter(owns);
  if (entries.length > 0) {
    await remote.upsert(
      'entries',
      entries.map((e: EntryRow) => stripLocal(e, ['retryable'])),
    );
    await markEntriesSynced(
      adapter,
      entries.map((e) => ({ id: e.id, updated_at: e.updated_at })),
    );
  }

  const weights = (await listDirtyWeights(adapter)).filter(owns);
  if (weights.length > 0) {
    await remote.upsert(
      'weights',
      weights.map((w: WeightRow) => stripLocal(w)),
    );
    await markWeightsSynced(
      adapter,
      weights.map((w) => ({ id: w.id, updated_at: w.updated_at })),
    );
  }

  const profile = await adapter.get<ProfileRow>(
    ownerId === undefined
      ? 'SELECT * FROM profiles WHERE dirty = 1'
      : 'SELECT * FROM profiles WHERE dirty = 1 AND user_id = ?',
    ownerId === undefined ? [] : [ownerId],
  );
  if (profile) {
    await remote.upsert('profiles', [stripLocal(profile)]);
    await adapter.run('UPDATE profiles SET dirty = 0 WHERE user_id = ? AND updated_at = ?', [
      profile.user_id,
      profile.updated_at,
    ]);
  }

  // Kitchen must carry the same ownerId scope as profiles — an unscoped read
  // could push a placeholder-owned row under the wrong owner (security review,
  // defense-in-depth).
  const kitchen = await adapter.get<KitchenRow>(
    ownerId === undefined
      ? 'SELECT * FROM kitchen WHERE dirty = 1'
      : 'SELECT * FROM kitchen WHERE dirty = 1 AND user_id = ?',
    ownerId === undefined ? [] : [ownerId],
  );
  if (kitchen) {
    await remote.upsert('kitchen', [stripLocal(kitchen)]);
    await adapter.run('UPDATE kitchen SET dirty = 0 WHERE user_id = ? AND updated_at = ?', [
      kitchen.user_id,
      kitchen.updated_at,
    ]);
  }
}

/**
 * Down-sync one user's rows from Supabase into SQLite (spec/04: Supabase is
 * truth). Without this, SQLite is a write-only sink — a reinstall or a second
 * device shows an empty journal while the server holds everything. Merge rules
 * (LWW + dirty-skip + tombstone) live in the repo pullMerge* helpers; each
 * table's merge runs in its own transaction so a mid-pull failure never leaves
 * a half-written table. Best-effort: failures are non-fatal (caller catches).
 */
export async function pullUserData(
  adapter: SqlAdapter,
  remote: RemoteDb,
  userId: string,
): Promise<void> {
  const entries = await remote.fetchOwned('entries', userId);
  await adapter.transaction(() => pullMergeEntries(adapter, entries));

  const weights = await remote.fetchOwned('weights', userId);
  await adapter.transaction(() => pullMergeWeights(adapter, weights));

  const profiles = await remote.fetchOwned('profiles', userId);
  await adapter.transaction(() => pullMergeProfile(adapter, profiles[0]));

  const kitchen = await remote.fetchOwned('kitchen', userId);
  await adapter.transaction(() => pullMergeKitchen(adapter, kitchen[0]));
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
