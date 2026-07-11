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

/**
 * Distinct logged day keys (any intent, non-deleted), for the streak (§E0:
 * a day counts with ≥1 entry of any intent — one chai is a logged day).
 */
export async function listLoggedDates(adapter: SqlAdapter, userId: string): Promise<string[]> {
  const rows = await adapter.all<{ log_date: string }>(
    `SELECT DISTINCT log_date FROM entries
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY log_date DESC`,
    [userId],
  );
  return rows.map((r) => r.log_date);
}

/** One row per logged day for History: date, entry count, net kcal. */
export interface DaySummary {
  log_date: string;
  entry_count: number;
  net_kcal: number;
}

export async function listDaySummaries(
  adapter: SqlAdapter,
  userId: string,
  limit: number,
): Promise<DaySummary[]> {
  // Sums read the denormalised columns recomputeDay persists: food kcal is
  // positive, counted burns are negative kcal with is_included = 0.
  return adapter.all<DaySummary>(
    `SELECT log_date,
            COUNT(*) AS entry_count,
            COALESCE(SUM(CASE
              WHEN status = 'resolved' AND kcal IS NOT NULL AND is_included = 0 THEN kcal
              ELSE 0 END), 0) AS net_kcal
     FROM entries
     WHERE user_id = ? AND deleted_at IS NULL
     GROUP BY log_date
     ORDER BY log_date DESC
     LIMIT ?`,
    [userId, limit],
  );
}

/** Per-day sums inside an inclusive day-key range, for Stats (spec/02 §E). */
export interface DayStatRow {
  log_date: string;
  consumed_kcal: number;
  burned_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  water_ml: number;
}

export async function listDayStats(
  adapter: SqlAdapter,
  userId: string,
  start: string,
  end: string,
): Promise<DayStatRow[]> {
  return adapter.all<DayStatRow>(
    `SELECT log_date,
            COALESCE(SUM(CASE WHEN intent = 'food' AND status = 'resolved' THEN kcal ELSE 0 END), 0) AS consumed_kcal,
            COALESCE(SUM(CASE
              WHEN intent IN ('exercise','steps') AND status = 'resolved'
                   AND is_included = 0 AND kcal IS NOT NULL THEN -kcal
              ELSE 0 END), 0) AS burned_kcal,
            COALESCE(SUM(CASE WHEN intent = 'food' THEN protein_g ELSE 0 END), 0) AS protein_g,
            COALESCE(SUM(CASE WHEN intent = 'food' THEN carbs_g ELSE 0 END), 0) AS carbs_g,
            COALESCE(SUM(CASE WHEN intent = 'food' THEN fat_g ELSE 0 END), 0) AS fat_g,
            COALESCE(SUM(CASE WHEN intent = 'food' THEN fiber_g ELSE 0 END), 0) AS fiber_g,
            COALESCE(SUM(CASE WHEN intent = 'food' THEN sugar_g ELSE 0 END), 0) AS sugar_g,
            COALESCE(SUM(water_ml), 0) AS water_ml
     FROM entries
     WHERE user_id = ? AND deleted_at IS NULL AND log_date >= ? AND log_date <= ?
     GROUP BY log_date
     ORDER BY log_date ASC`,
    [userId, start, end],
  );
}

/** Every non-deleted entry, oldest first — the export bundle (spec/08). */
export async function listAllEntries(adapter: SqlAdapter, userId: string): Promise<EntryRow[]> {
  return adapter.all<EntryRow>(
    `SELECT * FROM entries
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY log_date ASC, position ASC`,
    [userId],
  );
}

export async function listDirtyEntries(adapter: SqlAdapter): Promise<EntryRow[]> {
  return adapter.all<EntryRow>('SELECT * FROM entries WHERE dirty = 1');
}

/** A row that was pushed, identified by id + the updated_at that was sent. */
export interface SyncedRef {
  id: string;
  updated_at: string;
}

/**
 * Clear the dirty flag ONLY on rows whose updated_at still matches what was
 * pushed. If the user edited a row between the dirty read and this mark,
 * patchEntry bumped updated_at (and re-set dirty=1); the guard misses, the row
 * stays dirty, and the newer edit is pushed on the next tick. Without the
 * guard the edit is silently lost.
 */
export async function markEntriesSynced(
  adapter: SqlAdapter,
  refs: readonly SyncedRef[],
): Promise<void> {
  for (const ref of refs) {
    await adapter.run('UPDATE entries SET dirty = 0 WHERE id = ? AND updated_at = ?', [
      ref.id,
      ref.updated_at,
    ]);
  }
}

/**
 * Merge server rows into SQLite (down-sync). Per row: insert if absent; skip
 * if the local copy is dirty (an unpushed local edit always wins until it
 * pushes); otherwise take the server row when it is strictly newer. Local-only
 * columns (dirty, retryable) are never written from the server. Callers wrap
 * this in a transaction.
 */
export async function pullMergeEntries(
  adapter: SqlAdapter,
  rows: readonly Record<string, SqlValue>[],
): Promise<void> {
  for (const row of rows) {
    await adapter.run(
      `INSERT INTO entries (
        id, user_id, log_date, position, raw_text, nickname, intent, status,
        resolved_ref, qty, unit, context,
        kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
        water_ml, step_count, sleep_minutes, is_included,
        calc_version, was_calibrated, created_at, updated_at, deleted_at,
        retryable, dirty
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)
      ON CONFLICT(id) DO UPDATE SET
        log_date = excluded.log_date, position = excluded.position,
        raw_text = excluded.raw_text, nickname = excluded.nickname,
        intent = excluded.intent, status = excluded.status,
        resolved_ref = excluded.resolved_ref, qty = excluded.qty,
        unit = excluded.unit, context = excluded.context, kcal = excluded.kcal,
        protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
        fat_g = excluded.fat_g, fiber_g = excluded.fiber_g,
        sugar_g = excluded.sugar_g, water_ml = excluded.water_ml,
        step_count = excluded.step_count, sleep_minutes = excluded.sleep_minutes,
        is_included = excluded.is_included, calc_version = excluded.calc_version,
        was_calibrated = excluded.was_calibrated, updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
      WHERE entries.dirty = 0 AND excluded.updated_at > entries.updated_at`,
      [
        row['id'] ?? null,
        row['user_id'] ?? null,
        row['log_date'] ?? null,
        row['position'] ?? null,
        row['raw_text'] ?? null,
        row['nickname'] ?? null,
        row['intent'] ?? null,
        row['status'] ?? null,
        row['resolved_ref'] ?? null,
        row['qty'] ?? null,
        row['unit'] ?? null,
        row['context'] ?? null,
        row['kcal'] ?? null,
        row['protein_g'] ?? null,
        row['carbs_g'] ?? null,
        row['fat_g'] ?? null,
        row['fiber_g'] ?? null,
        row['sugar_g'] ?? null,
        row['water_ml'] ?? null,
        row['step_count'] ?? null,
        row['sleep_minutes'] ?? null,
        row['is_included'] ?? 0,
        row['calc_version'] ?? null,
        row['was_calibrated'] ?? 0,
        row['created_at'] ?? null,
        row['updated_at'] ?? null,
        row['deleted_at'] ?? null,
      ],
    );
  }
}
