// Profiles + kitchen — one row each per user (spec/04). Defaults here mirror
// the Postgres schema exactly; `calorie_goal` stays null with no default
// (non-negotiable: Slate never picks a goal).

import { runTransaction, type SqlAdapter, type SqlValue } from './adapter';
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

export async function listDirtyWeights(adapter: SqlAdapter): Promise<WeightRow[]> {
  return adapter.all<WeightRow>('SELECT * FROM weights WHERE dirty = 1');
}

export async function markWeightsSynced(
  adapter: SqlAdapter,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) {
    await adapter.run('UPDATE weights SET dirty = 0 WHERE id = ?', [id]);
  }
}
