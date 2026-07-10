// Entries — one row per journal line (spec/04). Write-through: SQLite first,
// always; sync pushes dirty rows to Supabase when it can (spec/09 Offline).
// Ids and timestamps come from the caller so this stays deterministic.

import type { SqlAdapter, SqlValue } from './adapter';
import type { EntryRow, EntryStatus } from './rows';

export async function insertEntry(adapter: SqlAdapter, row: EntryRow): Promise<void> {
  await adapter.run(
    `INSERT INTO entries (
      id, user_id, log_date, position, raw_text, nickname, intent, status,
      resolved_ref, qty, unit, context,
      kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
      water_ml, step_count, sleep_minutes, is_included,
      calc_version, was_calibrated, created_at, updated_at, deleted_at,
      retryable, dirty
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.id,
      row.user_id,
      row.log_date,
      row.position,
      row.raw_text,
      row.nickname,
      row.intent,
      row.status,
      row.resolved_ref,
      row.qty,
      row.unit,
      row.context,
      row.kcal,
      row.protein_g,
      row.carbs_g,
      row.fat_g,
      row.fiber_g,
      row.sugar_g,
      row.water_ml,
      row.step_count,
      row.sleep_minutes,
      row.is_included,
      row.calc_version,
      row.was_calibrated,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.retryable,
      row.dirty,
    ],
  );
}

export async function listDay(
  adapter: SqlAdapter,
  userId: string,
  logDate: string,
): Promise<EntryRow[]> {
  return adapter.all<EntryRow>(
    `SELECT * FROM entries
     WHERE user_id = ? AND log_date = ? AND deleted_at IS NULL
     ORDER BY position ASC`,
    [userId, logDate],
  );
}

export async function getEntry(adapter: SqlAdapter, id: string): Promise<EntryRow | null> {
  return adapter.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
}

export async function nextPosition(
  adapter: SqlAdapter,
  userId: string,
  logDate: string,
): Promise<number> {
  const row = await adapter.get<{ max_pos: number | null }>(
    'SELECT MAX(position) AS max_pos FROM entries WHERE user_id = ? AND log_date = ?',
    [userId, logDate],
  );
  return (row?.max_pos ?? -1) + 1;
}

/** Fields a resolution (or recompute) may change. Everything else is fixed at insert. */
export interface EntryPatch {
  intent?: EntryRow['intent'];
  status?: EntryStatus;
  resolved_ref?: string | null;
  qty?: number | null;
  unit?: EntryRow['unit'];
  context?: EntryRow['context'];
  kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  sugar_g?: number | null;
  water_ml?: number | null;
  step_count?: number | null;
  sleep_minutes?: number | null;
  is_included?: number;
  was_calibrated?: number;
  calc_version?: string;
  raw_text?: string;
  nickname?: string | null;
  retryable?: number;
  deleted_at?: string | null;
}

export async function patchEntry(
  adapter: SqlAdapter,
  id: string,
  patch: EntryPatch,
  updatedAt: string,
): Promise<void> {
  const keys = Object.keys(patch) as (keyof EntryPatch)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k] as SqlValue);
  await adapter.run(`UPDATE entries SET ${sets}, updated_at = ?, dirty = 1 WHERE id = ?`, [
    ...values,
    updatedAt,
    id,
  ]);
}

/** Unresolved lines the retry queue should pick up, oldest first (spec/09). */
export async function listRetryable(adapter: SqlAdapter, userId: string): Promise<EntryRow[]> {
  return adapter.all<EntryRow>(
    `SELECT * FROM entries
     WHERE user_id = ? AND status = 'unresolved' AND retryable = 1 AND deleted_at IS NULL
     ORDER BY created_at ASC, position ASC`,
    [userId],
  );
}

/** Saved foods: nickname set → saved (spec/02 §B). Latest nickname wins per name. */
export async function listSavedFoods(adapter: SqlAdapter, userId: string): Promise<EntryRow[]> {
  return adapter.all<EntryRow>(
    `SELECT * FROM entries e
     WHERE e.user_id = ? AND e.nickname IS NOT NULL AND e.deleted_at IS NULL
       AND e.updated_at = (
         SELECT MAX(e2.updated_at) FROM entries e2
         WHERE e2.user_id = e.user_id AND e2.nickname = e.nickname AND e2.deleted_at IS NULL
       )
     ORDER BY e.updated_at DESC`,
    [userId],
  );
}

/** Recent distinct food texts for the suggestion strip. */
export async function listRecents(
  adapter: SqlAdapter,
  userId: string,
  limit: number,
): Promise<string[]> {
  const rows = await adapter.all<{ raw_text: string }>(
    `SELECT raw_text, MAX(created_at) AS latest FROM entries
     WHERE user_id = ? AND intent = 'food' AND status = 'resolved' AND deleted_at IS NULL
     GROUP BY raw_text ORDER BY latest DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.map((r) => r.raw_text);
}

export async function listDirtyEntries(adapter: SqlAdapter): Promise<EntryRow[]> {
  return adapter.all<EntryRow>('SELECT * FROM entries WHERE dirty = 1');
}

export async function markEntriesSynced(
  adapter: SqlAdapter,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) {
    await adapter.run('UPDATE entries SET dirty = 0 WHERE id = ?', [id]);
  }
}
