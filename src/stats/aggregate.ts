// Stats aggregation (spec/02 §E) — pure. Screens feed it day rows and weight
// rows; it returns what the four cards display. The 1,200 display floor binds
// here: Stats is a day-complete surface, so every per-day net it emits is
// displayNet (store true, show the floor — non-negotiable #4).

import { displayNet } from '../engine';
import { addDays, daysBetween } from '../journal/dates';

export type RangeKind = 'week' | 'month' | 'year' | 'range';

export interface StatsRange {
  /** inclusive day keys */
  start: string;
  end: string;
}

/**
 * Trailing windows ending today: 7 / 30 / 365 days. FLAG(nirmal): spec/02 §E
 * names the segments but not their arithmetic; trailing windows chosen over
 * calendar periods so "Week" always shows seven bars.
 */
export function rangeFor(kind: Exclude<RangeKind, 'range'>, today: string): StatsRange {
  const days = kind === 'week' ? 7 : kind === 'month' ? 30 : 365;
  return { start: addDays(today, -(days - 1)), end: today };
}

/** Per-day sums as read from entries (denormalised columns). */
export interface DayStat {
  log_date: string;
  consumed_kcal: number;
  burned_kcal: number; // positive magnitude
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  water_ml: number;
}

export interface CalorieBucket {
  /** first day key of the bucket */
  start: string;
  /** mean floored net across logged days in the bucket; null when none */
  netKcal: number | null;
}

export interface CaloriesCard {
  buckets: CalorieBucket[];
  /** mean floored net across all logged days in range; null when none */
  averageKcal: number | null;
}

export interface MacrosCard {
  /** mean grams per logged day */
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** shares of the three, summing to 1 (0 when no macros logged) */
  proteinShare: number;
  carbsShare: number;
  fatShare: number;
  loggedDays: number;
}

export interface FiberSugarCard {
  fiberG: number;
  sugarG: number;
}

export interface WeightPoint {
  log_date: string;
  weight_kg: number;
}

/**
 * Bucket size keeps the bar count readable: daily to a month, weekly to a
 * quarter, monthly beyond (a year = 12–13 bars, never 365).
 */
export function bucketDays(range: StatsRange): number {
  const span = daysBetween(range.start, range.end) + 1;
  if (span <= 31) return 1;
  if (span <= 92) return 7;
  return 30;
}

export function caloriesCard(stats: readonly DayStat[], range: StatsRange): CaloriesCard {
  const size = bucketDays(range);
  const byDay = new Map(stats.map((s) => [s.log_date, s]));
  const span = daysBetween(range.start, range.end) + 1;

  const flooredNets: number[] = [];
  const buckets: CalorieBucket[] = [];
  for (let offset = 0; offset < span; offset += size) {
    const bucketStart = addDays(range.start, offset);
    const nets: number[] = [];
    for (let d = 0; d < size && offset + d < span; d++) {
      const stat = byDay.get(addDays(range.start, offset + d));
      if (!stat || (stat.consumed_kcal === 0 && stat.burned_kcal === 0)) continue;
      const net = displayNet(stat.consumed_kcal, stat.burned_kcal);
      nets.push(net);
      flooredNets.push(net);
    }
    buckets.push({
      start: bucketStart,
      netKcal: nets.length > 0 ? nets.reduce((a, b) => a + b, 0) / nets.length : null,
    });
  }

  return {
    buckets,
    averageKcal:
      flooredNets.length > 0 ? flooredNets.reduce((a, b) => a + b, 0) / flooredNets.length : null,
  };
}

export function macrosCard(stats: readonly DayStat[]): MacrosCard {
  const logged = stats.filter((s) => s.protein_g + s.carbs_g + s.fat_g > 0);
  const n = logged.length;
  const proteinG = n > 0 ? logged.reduce((a, s) => a + s.protein_g, 0) / n : 0;
  const carbsG = n > 0 ? logged.reduce((a, s) => a + s.carbs_g, 0) / n : 0;
  const fatG = n > 0 ? logged.reduce((a, s) => a + s.fat_g, 0) / n : 0;
  const total = proteinG + carbsG + fatG;
  return {
    proteinG,
    carbsG,
    fatG,
    proteinShare: total > 0 ? proteinG / total : 0,
    carbsShare: total > 0 ? carbsG / total : 0,
    fatShare: total > 0 ? fatG / total : 0,
    loggedDays: n,
  };
}

export function fiberSugarCard(stats: readonly DayStat[]): FiberSugarCard {
  const logged = stats.filter((s) => s.fiber_g > 0 || s.sugar_g > 0);
  const n = logged.length;
  return {
    fiberG: n > 0 ? logged.reduce((a, s) => a + s.fiber_g, 0) / n : 0,
    sugarG: n > 0 ? logged.reduce((a, s) => a + s.sugar_g, 0) / n : 0,
  };
}

/** Weights inside the range, oldest first, for the line + latest headline. */
export function weightSeries(weights: readonly WeightPoint[], range: StatsRange): WeightPoint[] {
  return weights
    .filter((w) => w.log_date >= range.start && w.log_date <= range.end)
    .sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
}
