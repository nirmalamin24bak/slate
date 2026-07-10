// The logging streak (spec/02 §E0) — derived from entries at read time, no
// table, no counter to drift. It counts the act of writing and nothing else:
// no calories, no goals, no under/over. Breaking is silent; the number just
// resets. Backdating repairs it, because a filled day is a logged day.

import { addDays, daysBetween } from './dates';

export interface StreakInfo {
  /** consecutive logged days ending today, or yesterday if today is unlogged */
  current: number;
  longest: number;
}

/**
 * @param loggedDates distinct 'YYYY-MM-DD' day keys with ≥1 non-deleted entry
 *                    of any intent, in any order
 * @param today       device-timezone day key (midnight boundary)
 *
 * An unlogged today does not break the run — the streak is only broken once a
 * whole day has passed with nothing written. At breakfast, yesterday's 12 is
 * still 12.
 */
export function computeStreak(loggedDates: readonly string[], today: string): StreakInfo {
  const days = new Set(loggedDates);

  let current = 0;
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  // Longest run anywhere in history.
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of sorted) {
    run = prev !== null && daysBetween(prev, day) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = day;
  }

  return { current, longest: Math.max(longest, current) };
}

/**
 * The consistency dots (§E0): the trailing `weeks × 7` days as filled/hollow,
 * grouped by week, most recent day last. Row-major, oldest first — the screen
 * renders groups left to right.
 */
export function consistencyDots(
  loggedDates: readonly string[],
  today: string,
  weeks: number,
): boolean[][] {
  const days = new Set(loggedDates);
  const total = weeks * 7;
  const start = addDays(today, -(total - 1));
  const grid: boolean[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: boolean[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(days.has(addDays(start, w * 7 + d)));
    }
    grid.push(week);
  }
  return grid;
}
