// Export your data (spec/08 §3) — free, always. DPDP makes portability a
// right: profile, kitchen, every entry with raw_text and computed nutrition,
// every weight. Builders are pure (tested); the share step touches the fs.

import type { EntryRow, KitchenRow, ProfileRow, WeightRow } from '../db/rows';

export interface ExportBundle {
  exported_at: string;
  app: 'slate';
  profile: Record<string, unknown> | null;
  kitchen: Record<string, unknown> | null;
  entries: Record<string, unknown>[];
  weights: Record<string, unknown>[];
}

/** Local-only bookkeeping columns that aren't the user's data. */
const LOCAL_COLUMNS = new Set(['dirty', 'retryable']);

function publicColumns(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!LOCAL_COLUMNS.has(key)) out[key] = value;
  }
  return out;
}

export function buildBundle(
  profile: ProfileRow | null,
  kitchen: KitchenRow | null,
  entries: readonly EntryRow[],
  weights: readonly WeightRow[],
  exportedAt: string,
): ExportBundle {
  return {
    exported_at: exportedAt,
    app: 'slate',
    profile: profile ? publicColumns(profile) : null,
    kitchen: kitchen ? publicColumns(kitchen) : null,
    entries: entries.map((e) => publicColumns(e)),
    weights: weights.map((w) => publicColumns(w)),
  };
}

/** RFC 4180: quote when the value contains a comma, quote, or newline. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): string {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export const ENTRY_CSV_COLUMNS = [
  'log_date',
  'position',
  'raw_text',
  'nickname',
  'intent',
  'status',
  'resolved_ref',
  'qty',
  'unit',
  'context',
  'kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'sugar_g',
  'water_ml',
  'step_count',
  'sleep_minutes',
  'is_included',
  'calc_version',
  'was_calibrated',
  'created_at',
  'updated_at',
] as const;

export const WEIGHT_CSV_COLUMNS = ['log_date', 'weight_kg', 'source', 'created_at'] as const;

export function entriesCsv(entries: readonly EntryRow[]): string {
  return toCsv(
    entries.map((e) => e as unknown as Record<string, unknown>),
    ENTRY_CSV_COLUMNS,
  );
}

export function weightsCsv(weights: readonly WeightRow[]): string {
  return toCsv(
    weights.map((w) => w as unknown as Record<string, unknown>),
    WEIGHT_CSV_COLUMNS,
  );
}
