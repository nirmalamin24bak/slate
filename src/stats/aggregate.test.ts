import { describe, expect, it } from 'vitest';

import { addDays } from '../journal/dates';
import {
  bucketDays,
  caloriesCard,
  fiberSugarCard,
  macrosCard,
  rangeFor,
  weightSeries,
  type DayStat,
  type StatsRange,
  type WeightPoint,
} from './aggregate';

// Stats (spec/02 §E) is a day-complete surface: the 1,200 display floor binds
// on every per-day net it emits (non-negotiable #4 — store true, show the
// floor). Unlogged days are excluded from means, not counted as zeroes.

const TODAY = '2026-07-10';

function stat(overrides: Partial<DayStat> & { log_date: string }): DayStat {
  return {
    consumed_kcal: 0,
    burned_kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    sugar_g: 0,
    water_ml: 0,
    ...overrides,
  };
}

describe('rangeFor', () => {
  it('week = trailing 7 days ending today', () => {
    expect(rangeFor('week', TODAY)).toEqual({ start: '2026-07-04', end: TODAY });
  });

  it('month = trailing 30 days ending today', () => {
    expect(rangeFor('month', TODAY)).toEqual({ start: '2026-06-11', end: TODAY });
  });

  it('year = trailing 365 days ending today', () => {
    expect(rangeFor('year', TODAY)).toEqual({ start: '2025-07-11', end: TODAY });
  });
});

describe('bucketDays', () => {
  it('daily up to a month (span ≤ 31)', () => {
    expect(bucketDays({ start: '2026-07-04', end: TODAY })).toBe(1); // span 7
    expect(bucketDays({ start: addDays(TODAY, -30), end: TODAY })).toBe(1); // span 31
  });

  it('weekly up to a quarter (32 ≤ span ≤ 92)', () => {
    expect(bucketDays({ start: addDays(TODAY, -31), end: TODAY })).toBe(7); // span 32
    expect(bucketDays({ start: addDays(TODAY, -91), end: TODAY })).toBe(7); // span 92
  });

  it('monthly beyond a quarter (span > 92)', () => {
    expect(bucketDays({ start: addDays(TODAY, -92), end: TODAY })).toBe(30); // span 93
    expect(bucketDays(rangeFor('year', TODAY))).toBe(30);
  });
});

describe('caloriesCard', () => {
  const week: StatsRange = rangeFor('week', TODAY);

  it('the 1,200 net floor binds: a light day contributes 1200 to the mean', () => {
    // consumed 800, burned 0 → true net 800, but displayNet floors it to 1200.
    // If the floor did NOT bind, the average would be 800, not 1200.
    const card = caloriesCard([stat({ log_date: TODAY, consumed_kcal: 800 })], week);
    expect(card.averageKcal).toBe(1200);
    // and it shows in the bucket, not just the overall average
    const todayBucket = card.buckets.find((b) => b.start === TODAY);
    expect(todayBucket?.netKcal).toBe(1200);
  });

  it('excludes unlogged days from the mean (not counted as zero)', () => {
    // Two logged days at net 2000; the other five days of the week are unlogged.
    const stats = [
      stat({ log_date: TODAY, consumed_kcal: 2000 }),
      stat({ log_date: addDays(TODAY, -1), consumed_kcal: 2000 }),
    ];
    const card = caloriesCard(stats, week);
    expect(card.averageKcal).toBe(2000); // mean over 2 logged days, not /7
  });

  it('a day with 0 consumed and 0 burned is treated as unlogged', () => {
    const stats = [
      stat({ log_date: TODAY, consumed_kcal: 2100 }),
      stat({ log_date: addDays(TODAY, -1) }), // all zero → unlogged
    ];
    const card = caloriesCard(stats, week);
    expect(card.averageKcal).toBe(2100);
    const emptyBucket = card.buckets.find((b) => b.start === addDays(TODAY, -1));
    expect(emptyBucket?.netKcal).toBeNull();
  });

  it('empty range → averageKcal null and every bucket null', () => {
    const card = caloriesCard([], week);
    expect(card.averageKcal).toBeNull();
    expect(card.buckets.every((b) => b.netKcal === null)).toBe(true);
  });

  it('exercise credits back into the day net before the floor', () => {
    // consumed 3000, burned 500 → net 2500 (above floor, no clamp).
    const card = caloriesCard(
      [stat({ log_date: TODAY, consumed_kcal: 3000, burned_kcal: 500 })],
      week,
    );
    expect(card.averageKcal).toBe(2500);
  });

  it('buckets group multiple days when the bucket size > 1', () => {
    // 60-day range → weekly buckets. Two logged days in the first week average.
    const range: StatsRange = { start: addDays(TODAY, -59), end: TODAY };
    expect(bucketDays(range)).toBe(7);
    const stats = [
      stat({ log_date: range.start, consumed_kcal: 2000 }),
      stat({ log_date: addDays(range.start, 1), consumed_kcal: 3000 }),
    ];
    const card = caloriesCard(stats, range);
    expect(card.buckets[0]?.start).toBe(range.start);
    expect(card.buckets[0]?.netKcal).toBe(2500); // (2000 + 3000) / 2
    expect(card.averageKcal).toBe(2500);
  });
});

describe('macrosCard', () => {
  it('means over logged days; shares sum to ~1', () => {
    const stats = [
      stat({ log_date: TODAY, protein_g: 100, carbs_g: 200, fat_g: 50 }),
      stat({ log_date: addDays(TODAY, -1), protein_g: 60, carbs_g: 240, fat_g: 30 }),
    ];
    const card = macrosCard(stats);
    expect(card.loggedDays).toBe(2);
    expect(card.proteinG).toBe(80);
    expect(card.carbsG).toBe(220);
    expect(card.fatG).toBe(40);
    expect(card.proteinShare + card.carbsShare + card.fatShare).toBeCloseTo(1, 9);
  });

  it('a day with no macros is excluded from the denominator', () => {
    const stats = [
      stat({ log_date: TODAY, protein_g: 40, carbs_g: 40, fat_g: 20 }),
      stat({ log_date: addDays(TODAY, -1) }), // no macros → not logged
    ];
    const card = macrosCard(stats);
    expect(card.loggedDays).toBe(1);
    expect(card.proteinG).toBe(40);
  });

  it('nothing logged → zeroes and zero shares (no divide-by-zero)', () => {
    const card = macrosCard([]);
    expect(card).toEqual({
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      proteinShare: 0,
      carbsShare: 0,
      fatShare: 0,
      loggedDays: 0,
    });
  });
});

describe('fiberSugarCard', () => {
  it('means fiber and sugar over days that logged either', () => {
    const stats = [
      stat({ log_date: TODAY, fiber_g: 20, sugar_g: 30 }),
      stat({ log_date: addDays(TODAY, -1), fiber_g: 10, sugar_g: 10 }),
    ];
    const card = fiberSugarCard(stats);
    expect(card.fiberG).toBe(15);
    expect(card.sugarG).toBe(20);
  });

  it('a day with fiber but no sugar still counts', () => {
    const stats = [stat({ log_date: TODAY, fiber_g: 12, sugar_g: 0 })];
    const card = fiberSugarCard(stats);
    expect(card.fiberG).toBe(12);
    expect(card.sugarG).toBe(0);
  });

  it('nothing logged → zeroes', () => {
    expect(fiberSugarCard([])).toEqual({ fiberG: 0, sugarG: 0 });
    // a purely-empty day is not "logged" for this card either
    expect(fiberSugarCard([stat({ log_date: TODAY })])).toEqual({ fiberG: 0, sugarG: 0 });
  });
});

describe('weightSeries', () => {
  const range: StatsRange = { start: '2026-07-01', end: '2026-07-31' };

  function w(log_date: string, weight_kg: number): WeightPoint {
    return { log_date, weight_kg };
  }

  it('filters to the range and sorts oldest first', () => {
    const points = [w('2026-07-20', 82), w('2026-07-05', 84), w('2026-07-31', 81)];
    expect(weightSeries(points, range)).toEqual([
      w('2026-07-05', 84),
      w('2026-07-20', 82),
      w('2026-07-31', 81),
    ]);
  });

  it('drops points before start and after end (inclusive bounds kept)', () => {
    const points = [
      w('2026-06-30', 90), // before start → dropped
      w('2026-07-01', 85), // == start → kept
      w('2026-07-31', 80), // == end → kept
      w('2026-08-01', 79), // after end → dropped
    ];
    expect(weightSeries(points, range).map((p) => p.log_date)).toEqual([
      '2026-07-01',
      '2026-07-31',
    ]);
  });

  it('empty input → empty series', () => {
    expect(weightSeries([], range)).toEqual([]);
  });
});
