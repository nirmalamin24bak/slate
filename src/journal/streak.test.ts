import { describe, expect, it } from 'vitest';

import { addDays } from './dates';
import { computeStreak, consistencyDots } from './streak';

// The logging streak (spec/02 §E0) counts the act of writing, nothing else.
// SAFETY: an unlogged today must not break a run — at breakfast, yesterday's
// count still stands. Backdating repairs a run. Breaking is silent (the number
// just resets; no copy is tested here because there is none to test).

const TODAY = '2026-07-10';

/** Contiguous run of `n` days ending on `end` (inclusive), oldest first. */
function run(end: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(end, -i));
  return out;
}

describe('computeStreak', () => {
  it('empty input → {current: 0, longest: 0}', () => {
    expect(computeStreak([], TODAY)).toEqual({ current: 0, longest: 0 });
  });

  it('a run ending today counts today', () => {
    const dates = run(TODAY, 5); // 06..10 July
    expect(computeStreak(dates, TODAY).current).toBe(5);
  });

  it('unlogged TODAY does not break a run that reached yesterday', () => {
    // Nothing logged today; the streak counts back from yesterday. This is the
    // whole safety point of §E0 — not-yet-logged is not the same as broken.
    const dates = run(addDays(TODAY, -1), 4); // 06..09 July, today (10) empty
    expect(computeStreak(dates, TODAY).current).toBe(4);
  });

  it('a whole empty day (day before yesterday) does break the run', () => {
    // Today empty is fine; but if yesterday is ALSO empty, the run is broken.
    const dates = run(addDays(TODAY, -3), 3); // ends 07 July; 08,09,10 empty
    expect(computeStreak(dates, TODAY).current).toBe(0);
  });

  it('a single gap ends the current run at the gap', () => {
    // 06,07 logged, 08 missing, 09 logged, today (10) empty → current counts
    // back from yesterday (09) and stops at the 08 gap: just 1.
    const dates = ['2026-07-06', '2026-07-07', '2026-07-09'];
    expect(computeStreak(dates, TODAY).current).toBe(1);
  });

  it('backdating a filled gap repairs the run into one contiguous streak', () => {
    const gapped = ['2026-07-06', '2026-07-07', '2026-07-09', '2026-07-10'];
    expect(computeStreak(gapped, TODAY).current).toBe(2); // 09,10 — 08 missing

    const repaired = [...gapped, '2026-07-08']; // user backdates the missing day
    expect(computeStreak(repaired, TODAY).current).toBe(5); // 06..10, one run
  });

  it('longest is the max run anywhere in history, independent of the current tail', () => {
    // A 6-day run in June, then a gap, then a 2-day run ending today.
    const june = run('2026-06-20', 6); // 15..20 June
    const now = run(TODAY, 2); // 09,10 July
    const info = computeStreak([...june, ...now], TODAY);
    expect(info.current).toBe(2);
    expect(info.longest).toBe(6);
  });

  it('longest is never less than current', () => {
    const dates = run(TODAY, 9);
    const info = computeStreak(dates, TODAY);
    expect(info.current).toBe(9);
    expect(info.longest).toBe(9);
    expect(info.longest).toBeGreaterThanOrEqual(info.current);
  });

  it('longest falls back to current when the tail is the longest run', () => {
    // Short old run (2), long current run (4). current wins longest via Math.max.
    const old = run('2026-06-01', 2);
    const now = run(TODAY, 4);
    const info = computeStreak([...old, ...now], TODAY);
    expect(info.current).toBe(4);
    expect(info.longest).toBe(4);
  });

  it('ignores duplicate day keys (a day with many entries is still one day)', () => {
    const dates = [TODAY, TODAY, addDays(TODAY, -1), addDays(TODAY, -1)];
    expect(computeStreak(dates, TODAY).current).toBe(2);
  });

  it('unordered input is handled (order-independent)', () => {
    const dates = ['2026-07-10', '2026-07-08', '2026-07-09'];
    expect(computeStreak(dates, TODAY)).toEqual({ current: 3, longest: 3 });
  });
});

describe('consistencyDots', () => {
  it('returns weeks × 7 booleans, row-major', () => {
    const grid = consistencyDots([], TODAY, 4);
    expect(grid).toHaveLength(4);
    for (const week of grid) expect(week).toHaveLength(7);
  });

  it('all false when nothing is logged', () => {
    const grid = consistencyDots([], TODAY, 2);
    expect(grid.flat().every((d) => d === false)).toBe(true);
  });

  it('most-recent day is last (final cell of the final week is today)', () => {
    const grid = consistencyDots([TODAY], TODAY, 1);
    const week = grid[0];
    expect(week?.[6]).toBe(true); // today occupies the last cell
    expect(week?.slice(0, 6).every((d) => d === false)).toBe(true);
  });

  it('oldest day is first (first cell of the first week)', () => {
    // 1 week window → the first cell is 6 days before today.
    const oldest = addDays(TODAY, -6);
    const grid = consistencyDots([oldest], TODAY, 1);
    expect(grid[0]?.[0]).toBe(true);
    expect(grid[0]?.slice(1).every((d) => d === false)).toBe(true);
  });

  it('places each logged day in the correct row-major cell across weeks', () => {
    // 2-week window (14 days): today is week 1, index 6; 7 days back is week 0,
    // index 6; 13 days back is week 0, index 0.
    const grid = consistencyDots([TODAY, addDays(TODAY, -7), addDays(TODAY, -13)], TODAY, 2);
    expect(grid[1]?.[6]).toBe(true); // today
    expect(grid[0]?.[6]).toBe(true); // a week ago
    expect(grid[0]?.[0]).toBe(true); // start of window
    // exactly three filled cells
    expect(grid.flat().filter((d) => d).length).toBe(3);
  });

  it('days outside the trailing window are not shown', () => {
    const old = addDays(TODAY, -30); // outside a 2-week (14-day) window
    const grid = consistencyDots([old], TODAY, 2);
    expect(grid.flat().every((d) => d === false)).toBe(true);
  });
});
