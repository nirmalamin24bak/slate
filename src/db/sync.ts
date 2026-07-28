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

/**
 * Where a table's down-sync got to, as a point in a TOTAL order.
 *
 * Audit M6: this used to be a bare `updated_at` string, and the pull paged with
 * an offset range over rows ordered by `updated_at` alone. `updated_at` is not
 * unique — a day flushed from offline, or the adoption re-home, stamps many rows
 * within the same millisecond — so rows sharing a value could straddle a page
 * boundary and be silently skipped. The watermark then advanced past them and
 * they were never pulled again: permanent, invisible data loss, surfacing as
 * "my journal is gone" after a reinstall.
 *
 * `(updated_at, key)` is unique because `key` is the table's primary key, so it
 * is a total order, and a keyset cursor over a total order cannot skip or repeat
 * a row however the pages fall.
 */
export interface SyncCursor {
  updatedAt: string;
  key: string;
}

export interface RemoteDb {
  /** upsert rows into a table; throws on error */
  upsert(table: string, rows: readonly Record<string, SqlValue>[]): Promise<void>;
  /** full select of a reference table */
  fetchAll(table: string, columns: string): Promise<Record<string, SqlValue>[]>;
  /**
   * Select one user's rows from a user-owned table, paged internally.
   *
   * Returns rows strictly after `cursor` in the total order `(updated_at,
   * keyColumn)`, ascending, and MUST return them in that order — the caller
   * takes the last row as the next cursor. A null cursor pulls everything, which
   * is what a fresh install or a reinstall needs.
   */
  fetchOwned(
    table: string,
    userId: string,
    cursor: SyncCursor | null,
    keyColumn: string,
  ): Promise<Record<string, SqlValue>[]>;
}

/**
 * Rows per push. Must not exceed the server's sync_guard limit (migration
 * ...20260729000003); it is the same number on purpose, so the two move
 * together and the client never sends what the server will refuse.
 */
export const SYNC_BATCH_ROWS = 500;

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
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
  // One batch at a time, because the server refuses an oversized payload
  // (sync_guard, migration ...20260729000003 — an unbounded jsonb array was a
  // free denial-of-service). A device returning from a long offline stretch can
  // legitimately hold more than one batch of dirty rows, and without chunking
  // that push would raise forever and the journal would never reach the server.
  //
  // Each chunk is marked synced before the next is sent, so an interrupted push
  // keeps the ground it gained and the remainder rides the next tick.
  const entries = (await listDirtyEntries(adapter)).filter(owns);
  for (const batch of chunk(entries, SYNC_BATCH_ROWS)) {
    await remote.upsert(
      'entries',
      batch.map((e: EntryRow) => stripLocal(e, ['retryable'])),
    );
    await markEntriesSynced(
      adapter,
      batch.map((e) => ({ id: e.id, updated_at: e.updated_at })),
    );
  }

  const weights = (await listDirtyWeights(adapter)).filter(owns);
  for (const batch of chunk(weights, SYNC_BATCH_ROWS)) {
    await remote.upsert(
      'weights',
      batch.map((w: WeightRow) => stripLocal(w)),
    );
    await markWeightsSynced(
      adapter,
      batch.map((w) => ({ id: w.id, updated_at: w.updated_at })),
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

// --- delta-sync cursor (local bookkeeping in the `meta` k/v table) ---
// Per-table position in the total order this device has pulled up to.
// Namespaced by user so switching identity (anon → adopted) never reuses a
// stale cursor. Absent cursor → null → the table gets a full pull, which is
// exactly what a fresh install or a reinstall needs.
//
// The key is deliberately NOT the old `sync_watermark:` name. A device upgrading
// from a build that stored a bare timestamp there finds no cursor and does one
// full pull, which is correct (the merge is last-write-wins and never clobbers a
// dirty local row) — rather than this code parsing a legacy value as JSON.

/** The primary key each table's total order breaks ties on. */
const KEY_COLUMN: Record<string, string> = {
  entries: 'id',
  weights: 'id',
  profiles: 'user_id',
  kitchen: 'user_id',
};

function cursorKey(table: string, userId: string): string {
  return `sync_cursor:${userId}:${table}`;
}

async function getCursor(
  adapter: SqlAdapter,
  table: string,
  userId: string,
): Promise<SyncCursor | null> {
  const row = await adapter.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
    cursorKey(table, userId),
  ]);
  if (!row?.value) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { updatedAt, key } = parsed as Partial<SyncCursor>;
    if (typeof updatedAt !== 'string' || typeof key !== 'string') return null;
    return { updatedAt, key };
  } catch {
    // Unreadable cursor → full pull. Costly, never wrong.
    return null;
  }
}

async function setCursor(
  adapter: SqlAdapter,
  table: string,
  userId: string,
  cursor: SyncCursor,
): Promise<void> {
  await adapter.run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [cursorKey(table, userId), JSON.stringify(cursor)],
  );
}

/**
 * The cursor for the next pull: the LAST row of this page, not the maximum of
 * it. The remote returns rows in total order, so the last row is the greatest —
 * and taking it by position rather than by comparison is what makes the cursor
 * carry the tiebreaker key as well as the timestamp.
 */
export function cursorOf(
  rows: readonly Record<string, SqlValue>[],
  keyColumn: string,
): SyncCursor | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const updatedAt = last['updated_at'];
  const key = last[keyColumn];
  if (typeof updatedAt !== 'string' || typeof key !== 'string') return null;
  return { updatedAt, key };
}

/** Fetch one page of rows strictly after `cursor`, in total order, at most `limit` rows. */
export type PageFetcher = (
  cursor: SyncCursor | null,
  limit: number,
) => Promise<Record<string, SqlValue>[]>;

/**
 * Walk every page of a keyset-paginated read and return the rows.
 *
 * This lives here, away from the Supabase client, because it is the part of the
 * pull that was wrong (audit M6) and the part that has to be tested against a
 * page boundary landing in the middle of a run of identical `updated_at` values.
 * `src/lib/services.ts` supplies a `fetchPage` that talks to PostgREST; a test
 * supplies one backed by an array.
 */
export async function collectKeyset(
  fetchPage: PageFetcher,
  keyColumn: string,
  pageSize: number,
  initial: SyncCursor | null = null,
): Promise<Record<string, SqlValue>[]> {
  const all: Record<string, SqlValue>[] = [];
  let at: SyncCursor | null = initial;
  for (;;) {
    const page = await fetchPage(at, pageSize);
    all.push(...page);
    if (page.length < pageSize) return all; // short page = last page
    const next = cursorOf(page, keyColumn);
    // A full page whose last row yields no cursor would re-fetch itself forever.
    // Stop; the caller's stored cursor is unchanged and the next tick re-reads
    // this page, which the last-write-wins merge tolerates.
    if (next === null) return all;
    at = next;
  }
}

/**
 * Pull one table's delta, merge it, and advance the cursor. Kept generic so
 * every table follows the identical read → merge (in a transaction) → advance
 * sequence. The cursor advances only after a successful merge, and only when
 * the page was non-empty, so a failed/skipped merge never loses ground.
 */
async function pullTable(
  adapter: SqlAdapter,
  remote: RemoteDb,
  table: string,
  userId: string,
  merge: (rows: Record<string, SqlValue>[]) => Promise<void>,
): Promise<void> {
  const keyColumn = KEY_COLUMN[table] ?? 'id';
  const cursor = await getCursor(adapter, table, userId);
  const rows = await remote.fetchOwned(table, userId, cursor, keyColumn);
  await adapter.transaction(() => merge(rows));
  const next = cursorOf(rows, keyColumn);
  if (next !== null) await setCursor(adapter, table, userId, next);
}

/**
 * Down-sync one user's rows from Supabase into SQLite (spec/04: Supabase is
 * truth). Without this, SQLite is a write-only sink — a reinstall or a second
 * device shows an empty journal while the server holds everything. Merge rules
 * (LWW + dirty-skip + tombstone) live in the repo pullMerge* helpers; each
 * table's merge runs in its own transaction so a mid-pull failure never leaves
 * a half-written table. Best-effort: failures are non-fatal (caller catches).
 *
 * Delta sync: each table pulls only rows newer than this device's watermark
 * (full pull on first sync / reinstall). Soft-deletes bump updated_at, so
 * tombstones ride the delta and still reach the device.
 */
export async function pullUserData(
  adapter: SqlAdapter,
  remote: RemoteDb,
  userId: string,
): Promise<void> {
  await pullTable(adapter, remote, 'entries', userId, (rows) => pullMergeEntries(adapter, rows));
  await pullTable(adapter, remote, 'weights', userId, (rows) => pullMergeWeights(adapter, rows));
  await pullTable(adapter, remote, 'profiles', userId, (rows) =>
    pullMergeProfile(adapter, rows[0]),
  );
  await pullTable(adapter, remote, 'kitchen', userId, (rows) => pullMergeKitchen(adapter, rows[0]));
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
    'id,name,default_unit,default_qty,is_home_cookable,cooking_fat_ml,serving_g',
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
