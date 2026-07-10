// Day keys — device timezone, midnight boundary (spec/02 §E0). A log_date is
// a local calendar day string 'YYYY-MM-DD'; entries belong to the day the
// user says they belong to, not to created_at.

export const FREE_HISTORY_DAYS = 30;

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  // noon avoids DST edges shifting the calendar day
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Free tier reaches 30 days back and never forward (spec/09 Backdating:
 * future dates are Plus; beyond 30 days the scrubber shows a Plus row).
 */
export function isWithinFreeWindow(key: string, today: string): boolean {
  const back = daysBetween(key, today);
  return back >= 0 && back <= FREE_HISTORY_DAYS;
}
