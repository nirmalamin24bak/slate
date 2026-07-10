import { describe, expect, it } from 'vitest';

import { flushOnboarding, getKitchen, getProfile } from '../db/profileRepo';
import {
  bmrPreview,
  cmFromFtIn,
  DEFAULT_DRAFT,
  dobFromAge,
  ftInFromCm,
  GOAL_REJECTION_MESSAGE,
  toKitchenPatch,
  toProfilePatch,
  validateGoal,
  type OnboardingDraft,
} from './draft';

import { openTestDb } from '../../test/helpers/betterSqliteAdapter';

const NOW = new Date('2026-07-10T10:00:00.000Z');

const FULL: OnboardingDraft = {
  body: { age: 30, sex: 'male', heightCm: 175, weightKg: 85, skipped: false },
  kitchen: {
    katoriMl: 250,
    rotiG: 50,
    oilBottleDays: 20,
    householdSize: 3,
    chaiSugarTsp: 2,
    chaiMilk: 'full',
    skipped: false,
  },
  calorieGoal: 2200,
  remindersEnabled: true,
};

describe('unit conversion at the input boundary', () => {
  it('ft-in → cm and back', () => {
    expect(cmFromFtIn(5, 9)).toBeCloseTo(175.3, 1);
    expect(ftInFromCm(175)).toEqual({ feet: 5, inches: 9 });
  });
});

describe('O6 preview', () => {
  it('shows BMR and sedentary baseline for a complete body', () => {
    const preview = bmrPreview(FULL.body);
    expect(preview.bmr).toBeCloseTo(1618.875, 3);
    expect(preview.baseline).toBeCloseTo(1618.875 * 1.2, 3);
  });

  it('skip → no numbers at all, never fabricated', () => {
    expect(bmrPreview({ ...FULL.body, skipped: true })).toEqual({ bmr: null, baseline: null });
    expect(bmrPreview({ ...FULL.body, sex: null })).toEqual({ bmr: null, baseline: null });
  });

  it('under-18 → no numbers (DPDP)', () => {
    expect(bmrPreview({ ...FULL.body, age: 17 })).toEqual({ bmr: null, baseline: null });
  });
});

describe('O8 goal field', () => {
  it('empty is allowed — Slate never picks a goal', () => {
    expect(validateGoal('')).toEqual({ goal: null, error: null });
  });

  it('rejects below 1,200 with the plain message, no lecture', () => {
    expect(validateGoal('800')).toEqual({ goal: null, error: GOAL_REJECTION_MESSAGE });
    expect(validateGoal('1199')).toEqual({ goal: null, error: GOAL_REJECTION_MESSAGE });
  });

  it('accepts 1,200 and above', () => {
    expect(validateGoal('2200')).toEqual({ goal: 2200, error: null });
    expect(validateGoal('1200')).toEqual({ goal: 1200, error: null });
  });

  it('garbage is treated as empty, not an error state', () => {
    expect(validateGoal('two thousand')).toEqual({ goal: null, error: null });
  });
});

describe('draft → patches', () => {
  it('complete body lands with dob anchored age years back', () => {
    const patch = toProfilePatch(FULL, NOW);
    expect(patch.dob).toBe('1996-07-10');
    expect(patch.sex).toBe('male');
    expect(patch.weight_is_assumed).toBe(0);
    expect(patch.calorie_goal).toBe(2200);
    expect(dobFromAge(30, NOW)).toBe('1996-07-10');
  });

  it('skipped body: 65kg assumed fallback, nothing fabricated', () => {
    const patch = toProfilePatch(
      { ...FULL, body: { ...FULL.body, skipped: true }, calorieGoal: null },
      NOW,
    );
    expect(patch).toEqual({ weight_kg: 65, weight_is_assumed: 1, calorie_goal: null });
  });

  it('kitchen answers land; decoction milk maps to toned chai milk', () => {
    const patch = toKitchenPatch({
      ...FULL,
      kitchen: { ...FULL.kitchen, chaiMilk: 'decoction' },
    });
    expect(patch.chai_milk).toBe('toned');
    expect(patch.coffee_milk).toBe('decoction');
    expect(patch.is_assumed).toBe(0);
    expect(patch.katori_ml).toBe(250);
  });

  it('skipped kitchen keeps schema medians, flags assumed', () => {
    expect(toKitchenPatch({ ...FULL, kitchen: { ...FULL.kitchen, skipped: true } })).toEqual({
      is_assumed: 1,
    });
  });
});

describe('the one-transaction flush (spec/09)', () => {
  it('skip-everything path flushes and journal-critical fields hold', async () => {
    const skipped: OnboardingDraft = {
      ...DEFAULT_DRAFT,
      body: { ...DEFAULT_DRAFT.body, skipped: true },
      kitchen: { ...DEFAULT_DRAFT.kitchen, skipped: true },
    };
    const db = await openTestDb();
    await flushOnboarding(
      db,
      'user-x',
      toProfilePatch(skipped, NOW),
      toKitchenPatch(skipped),
      NOW.toISOString(),
    );
    const profile = await getProfile(db, 'user-x');
    const kitchen = await getKitchen(db, 'user-x');
    expect(profile?.calorie_goal).toBeNull();
    expect(profile?.weight_kg).toBe(65);
    expect(profile?.weight_is_assumed).toBe(1);
    expect(kitchen?.katori_ml).toBe(200);
    expect(kitchen?.is_assumed).toBe(1);
    db.close();
  });

  it('full draft flushes both rows atomically', async () => {
    const db = await openTestDb();
    await flushOnboarding(
      db,
      'user-y',
      toProfilePatch(FULL, NOW),
      toKitchenPatch(FULL),
      NOW.toISOString(),
    );
    const profile = await getProfile(db, 'user-y');
    const kitchen = await getKitchen(db, 'user-y');
    expect(profile?.calorie_goal).toBe(2200);
    expect(kitchen?.roti_g).toBe(50);
    db.close();
  });
});
