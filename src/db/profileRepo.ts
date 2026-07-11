// Profiles + kitchen — one row each per user (spec/04). Defaults here mirror
// the Postgres schema exactly; `calorie_goal` stays null with no default
// (non-negotiable: Slate never picks a goal).

import { runTransaction, type SqlAdapter, type SqlValue } from './adapter';
import type { SyncedRef } from './entriesRepo';
import type { KitchenRow, ProfileRow, WeightRow } from './rows';

export async function getProfile(adapter: SqlAdapter, userId: string): Promise<ProfileRow | null> {
  return adapter.get<ProfileRow>('SELECT * FROM profiles WHERE user_id = ?', [userId]);
}

export async function getKitchen(adapter: SqlAdapter, userId: string): Promise<KitchenRow | null> {
  return adapter.get<KitchenRow>('SELECT * FROM kitchen WHERE user_id = ?', [userId]);
}

/** Insert schema-default rows if none exist yet. Idempotent. */
export async function ensureUserRows(
  adapter: SqlAdapter,
  userId: string,
  nowIso: string,
): Promise<void> {
  await adapter.run(
    `INSERT OR IGNORE INTO profiles (user_id, created_at, updated_at) VALUES (?, ?, ?)`,
    [userId, nowIso, nowIso],
  );
  await adapter.run(
    `INSERT OR IGNORE INTO kitchen (user_id, created_at, updated_at) VALUES (?, ?, ?)`,
    [userId, nowIso, nowIso],
  );
}

export type ProfilePatch = Partial<
  Omit<ProfileRow, 'user_id' | 'created_at' | 'updated_at' | 'dirty'>
>;
export type KitchenPatch = Partial<
  Omit<KitchenRow, 'user_id' | 'created_at' | 'updated_at' | 'dirty'>
>;

async function patchRow(
  adapter: SqlAdapter,
  table: 'profiles' | 'kitchen',
  userId: string,
  patch: Record<string, SqlValue | undefined>,
  nowIso: string,
): Promise<void> {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k] as SqlValue);
  await adapter.run(`UPDATE ${table} SET ${sets}, updated_at = ?, dirty = 1 WHERE user_id = ?`, [
    ...values,
    nowIso,
    userId,
  ]);
}

export async function patchProfile(
  adapter: SqlAdapter,
  userId: string,
  patch: ProfilePatch,
  nowIso: string,
): Promise<void> {
  await patchRow(
    adapter,
    'profiles',
    userId,
    patch as Record<string, SqlValue | undefined>,
    nowIso,
  );
}

export async function patchKitchen(
  adapter: SqlAdapter,
  userId: string,
  patch: KitchenPatch,
  nowIso: string,
): Promise<void> {
  await patchRow(adapter, 'kitchen', userId, patch as Record<string, SqlValue | undefined>, nowIso);
}

/**
 * The onboarding flush (spec/09): everything collected before Start lands in
 * profiles + kitchen in ONE transaction, the moment a session exists.
 */
export async function flushOnboarding(
  adapter: SqlAdapter,
  userId: string,
  profile: ProfilePatch,
  kitchen: KitchenPatch,
  nowIso: string,
): Promise<void> {
  await runTransaction(adapter, async () => {
    await ensureUserRows(adapter, userId, nowIso);
    await patchProfile(adapter, userId, profile, nowIso);
    await patchKitchen(adapter, userId, kitchen, nowIso);
  });
}

// --- weights (spec/04): unique (user_id, log_date), last one wins ---

export async function upsertWeight(adapter: SqlAdapter, row: WeightRow): Promise<void> {
  await adapter.run(
    `INSERT INTO weights (id, user_id, log_date, weight_kg, source, created_at, updated_at, deleted_at, dirty)
     VALUES (?,?,?,?,?,?,?,?,1)
     ON CONFLICT (user_id, log_date) DO UPDATE SET
       weight_kg = excluded.weight_kg,
       source = excluded.source,
       updated_at = excluded.updated_at,
       deleted_at = NULL,
       dirty = 1`,
    [
      row.id,
      row.user_id,
      row.log_date,
      row.weight_kg,
      row.source,
      row.created_at,
      row.updated_at,
      row.deleted_at,
    ],
  );
}

/** Non-deleted weights, oldest first — Stats' line and the export bundle. */
export async function listWeights(adapter: SqlAdapter, userId: string): Promise<WeightRow[]> {
  return adapter.all<WeightRow>(
    `SELECT * FROM weights
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY log_date ASC`,
    [userId],
  );
}

export async function listDirtyWeights(adapter: SqlAdapter): Promise<WeightRow[]> {
  return adapter.all<WeightRow>('SELECT * FROM weights WHERE dirty = 1');
}

/** See markEntriesSynced: clear dirty only if the row wasn't re-edited. */
export async function markWeightsSynced(
  adapter: SqlAdapter,
  refs: readonly SyncedRef[],
): Promise<void> {
  for (const ref of refs) {
    await adapter.run('UPDATE weights SET dirty = 0 WHERE id = ? AND updated_at = ?', [
      ref.id,
      ref.updated_at,
    ]);
  }
}

// --- down-sync merges (LWW, dirty-skip). Callers wrap in a transaction. ---

/**
 * Weights merge on the natural key (user_id, log_date), not id: two devices
 * logging the same day mint different UUIDs but must converge to one row. The
 * local unique(user_id, log_date) would otherwise reject the second insert.
 */
export async function pullMergeWeights(
  adapter: SqlAdapter,
  rows: readonly Record<string, SqlValue>[],
): Promise<void> {
  for (const row of rows) {
    await adapter.run(
      `INSERT INTO weights (id, user_id, log_date, weight_kg, source, created_at, updated_at, deleted_at, dirty)
       VALUES (?,?,?,?,?,?,?,?,0)
       ON CONFLICT(user_id, log_date) DO UPDATE SET
         weight_kg = excluded.weight_kg, source = excluded.source,
         updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
       WHERE weights.dirty = 0 AND excluded.updated_at > weights.updated_at`,
      [
        row['id'] ?? null,
        row['user_id'] ?? null,
        row['log_date'] ?? null,
        row['weight_kg'] ?? null,
        row['source'] ?? null,
        row['created_at'] ?? null,
        row['updated_at'] ?? null,
        row['deleted_at'] ?? null,
      ],
    );
  }
}

/**
 * Profile/kitchen are one row per user, keyed on user_id. The local row always
 * exists before a pull (services.build runs ensureUserRows first), so this is a
 * guarded UPDATE, not an upsert: LWW on updated_at, and a locally-dirty row is
 * never overwritten. Only columns actually present in the server payload are
 * written, so a column the server omits keeps its local value rather than
 * becoming null — and there is no partial-INSERT path to violate NOT NULL.
 */
async function pullMergeSingleton(
  adapter: SqlAdapter,
  table: 'profiles' | 'kitchen',
  columns: readonly string[],
  row: Record<string, SqlValue> | undefined,
): Promise<void> {
  if (!row || row['updated_at'] === undefined || row['user_id'] === undefined) return;
  const writable = columns.filter((c) => c !== 'user_id' && c in row);
  if (writable.length === 0) return;
  const sets = writable.map((c) => `${c} = ?`).join(', ');
  await adapter.run(
    `UPDATE ${table} SET ${sets}
     WHERE user_id = ? AND dirty = 0 AND ? > updated_at`,
    [
      ...writable.map((c) => row[c] as SqlValue),
      row['user_id'] as SqlValue,
      row['updated_at'] as SqlValue,
    ],
  );
}

const PROFILE_COLUMNS = [
  'user_id',
  'dob',
  'sex',
  'height_cm',
  'weight_kg',
  'weight_is_assumed',
  'calorie_goal',
  'protein_goal_g',
  'carbs_goal_g',
  'fat_goal_g',
  'unit_height',
  'hide_calories',
  'show_macros',
  'show_fiber_sugar',
  'show_exercise',
  'show_weight',
  'show_water',
  'show_steps',
  'show_sleep',
  'personalization',
  'created_at',
  'updated_at',
] as const;

const KITCHEN_COLUMNS = [
  'user_id',
  'katori_ml',
  'roti_g',
  'oil_bottle_ml',
  'oil_bottle_days',
  'household_size',
  'chai_sugar_tsp',
  'chai_milk',
  'coffee_sugar_tsp',
  'coffee_milk',
  'is_assumed',
  'created_at',
  'updated_at',
] as const;

export async function pullMergeProfile(
  adapter: SqlAdapter,
  row: Record<string, SqlValue> | undefined,
): Promise<void> {
  await pullMergeSingleton(adapter, 'profiles', PROFILE_COLUMNS, row);
}

export async function pullMergeKitchen(
  adapter: SqlAdapter,
  row: Record<string, SqlValue> | undefined,
): Promise<void> {
  await pullMergeSingleton(adapter, 'kitchen', KITCHEN_COLUMNS, row);
}
