import { describe, expect, it } from 'vitest';

import type { EntryRow, KitchenRow, ProfileRow, WeightRow } from '../db/rows';
import {
  buildBundle,
  csvField,
  entriesCsv,
  ENTRY_CSV_COLUMNS,
  toCsv,
  weightsCsv,
  WEIGHT_CSV_COLUMNS,
} from './export';

// Export (spec/08 §3) is a DPDP right, not a feature: it must include the
// user's entries verbatim (raw_text), and must NOT leak local-only bookkeeping
// columns (dirty/retryable) that aren't the user's data.

function entry(overrides: Partial<EntryRow>): EntryRow {
  return {
    id: 'e1',
    user_id: 'u',
    log_date: '2026-07-10',
    position: 0,
    raw_text: '2 roti',
    nickname: null,
    intent: 'food',
    status: 'resolved',
    resolved_ref: 'dish_roti',
    qty: 2,
    unit: 'roti',
    context: 'home',
    kcal: 224,
    protein_g: 8,
    carbs_g: 45,
    fat_g: 2,
    fiber_g: 7,
    sugar_g: 1,
    water_ml: null,
    step_count: null,
    sleep_minutes: null,
    is_included: 0,
    calc_version: 'engine-v1',
    was_calibrated: 1,
    created_at: '2026-07-10T09:00:00.000Z',
    updated_at: '2026-07-10T09:00:00.000Z',
    deleted_at: null,
    retryable: 0,
    dirty: 1,
    ...overrides,
  };
}

function weight(overrides: Partial<WeightRow>): WeightRow {
  return {
    id: 'w1',
    user_id: 'u',
    log_date: '2026-07-10',
    weight_kg: 82,
    source: 'journal',
    created_at: '2026-07-10T07:00:00.000Z',
    updated_at: '2026-07-10T07:00:00.000Z',
    deleted_at: null,
    dirty: 0,
    ...overrides,
  };
}

const PROFILE: ProfileRow = {
  user_id: 'u',
  dob: '1995-01-01',
  sex: 'male',
  height_cm: 175,
  weight_kg: 82,
  weight_is_assumed: 0,
  calorie_goal: 1800,
  protein_goal_g: null,
  carbs_goal_g: null,
  fat_goal_g: null,
  unit_height: 'cm',
  hide_calories: 0,
  show_macros: 1,
  show_fiber_sugar: 0,
  show_exercise: 0,
  show_weight: 0,
  show_water: 0,
  show_steps: 0,
  show_sleep: 0,
  personalization: 'less oil',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  dirty: 1,
};

const KITCHEN: KitchenRow = {
  user_id: 'u',
  katori_ml: 200,
  roti_g: 35,
  oil_bottle_ml: 1000,
  oil_bottle_days: 30,
  household_size: 4,
  chai_sugar_tsp: 1,
  chai_milk: 'toned',
  coffee_sugar_tsp: 1,
  coffee_milk: 'toned',
  is_assumed: 0,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  dirty: 0,
};

describe('buildBundle', () => {
  it('omits local-only dirty/retryable but keeps raw_text verbatim', () => {
    const bundle = buildBundle(
      PROFILE,
      KITCHEN,
      [entry({ raw_text: 'aloo paratha' })],
      [weight({})],
      '2026-07-10T12:00:00.000Z',
    );
    const e = bundle.entries[0];
    expect(e).toBeDefined();
    expect(e).not.toHaveProperty('dirty');
    expect(e).not.toHaveProperty('retryable');
    expect(e?.raw_text).toBe('aloo paratha'); // the user's entry, verbatim
    // profile and kitchen also drop their dirty flag
    expect(bundle.profile).not.toHaveProperty('dirty');
    expect(bundle.kitchen).not.toHaveProperty('dirty');
    // weights keep everything but dirty
    expect(bundle.weights[0]).not.toHaveProperty('dirty');
    expect(bundle.weights[0]?.weight_kg).toBe(82);
  });

  it('carries the envelope: app tag and the exported_at stamp', () => {
    const bundle = buildBundle(null, null, [], [], '2026-07-10T12:00:00.000Z');
    expect(bundle.app).toBe('slate');
    expect(bundle.exported_at).toBe('2026-07-10T12:00:00.000Z');
  });

  it('null profile and kitchen serialize as null, not {}', () => {
    const bundle = buildBundle(null, null, [entry({})], [], '2026-07-10T12:00:00.000Z');
    expect(bundle.profile).toBeNull();
    expect(bundle.kitchen).toBeNull();
    expect(bundle.entries).toHaveLength(1);
  });
});

describe('csvField (RFC 4180)', () => {
  it('passes plain values through unquoted', () => {
    expect(csvField('roti')).toBe('roti');
    expect(csvField(224)).toBe('224');
    expect(csvField(0)).toBe('0');
  });

  it('empty string for null and undefined', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('quotes fields containing a comma', () => {
    expect(csvField('dal, rice')).toBe('"dal, rice"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvField('2" roti')).toBe('"2"" roti"');
    expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes fields containing newlines and carriage returns', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('a\r\nb')).toBe('"a\r\nb"');
  });
});

describe('toCsv', () => {
  it('emits a header row then one row per record, CRLF-terminated', () => {
    const csv = toCsv(
      [
        { a: 1, b: 'x' },
        { a: 2, b: 'y' },
      ],
      ['a', 'b'],
    );
    expect(csv).toBe('a,b\r\n1,x\r\n2,y\r\n');
  });

  it('missing keys become empty fields', () => {
    const csv = toCsv([{ a: 1 }], ['a', 'b']);
    expect(csv).toBe('a,b\r\n1,\r\n');
  });

  it('header only when there are no rows', () => {
    expect(toCsv([], ['a', 'b'])).toBe('a,b\r\n');
  });
});

describe('entriesCsv / weightsCsv', () => {
  it('entries: header row then one row per entry', () => {
    const csv = entriesCsv([
      entry({ raw_text: 'chai' }),
      entry({ id: 'e2', raw_text: 'dal, rice' }),
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(ENTRY_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(3); // header + 2 entries
    // the raw_text with a comma is quoted, proving the field escaping is wired
    expect(lines[2]).toContain('"dal, rice"');
  });

  it('weights: header row then one row per weight', () => {
    const csv = weightsCsv([weight({}), weight({ id: 'w2', weight_kg: 81 })]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(WEIGHT_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('82');
  });

  it('empty entry/weight lists produce a header-only CSV', () => {
    expect(entriesCsv([])).toBe(ENTRY_CSV_COLUMNS.join(',') + '\r\n');
    expect(weightsCsv([])).toBe(WEIGHT_CSV_COLUMNS.join(',') + '\r\n');
  });
});
