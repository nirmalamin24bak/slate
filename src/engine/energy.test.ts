import { describe, expect, test } from 'vitest';
import {
  baseline,
  bmr,
  dayMovementBurn,
  displayNet,
  isValidGoal,
  metBurn,
  stepsBurn,
  weightForCalc,
} from './energy';

// Anchors from spec/06-NUTRITION-ENGINE.md — Mifflin-St Jeor × 0.90 (ICMR-NIN 2020),
// baseline × 1.2 sedentary, MET formula, steps burn, double-count rule, 1200 floor.

describe('bmr', () => {
  test('male 85kg 175cm 30y: Mifflin raw 1798.75 × 0.90', () => {
    expect(bmr({ sex: 'male', weightKg: 85, heightCm: 175, age: 30 })).toBeCloseTo(1618.875, 5);
  });

  test('female 60kg 160cm 28y: Mifflin raw 1299 × 0.90', () => {
    expect(bmr({ sex: 'female', weightKg: 60, heightCm: 160, age: 28 })).toBeCloseTo(1169.1, 5);
  });

  test('under 18 → null (DPDP: no numbers for minors)', () => {
    expect(bmr({ sex: 'male', weightKg: 70, heightCm: 170, age: 17 })).toBeNull();
  });

  test('unknown sex → null (a fabricated BMR is worse than none)', () => {
    expect(bmr({ sex: null, weightKg: 70, heightCm: 170, age: 30 })).toBeNull();
  });

  test('missing height or weight → null', () => {
    expect(bmr({ sex: 'male', weightKg: null, heightCm: 170, age: 30 })).toBeNull();
    expect(bmr({ sex: 'male', weightKg: 70, heightCm: null, age: 30 })).toBeNull();
    expect(bmr({ sex: 'male', weightKg: 70, heightCm: 170, age: null })).toBeNull();
  });
});

describe('baseline', () => {
  test('BMR × 1.2, no activity multiplier', () => {
    expect(baseline(1618.875)).toBeCloseTo(1942.65, 5);
  });

  test('null BMR → null baseline', () => {
    expect(baseline(null)).toBeNull();
  });
});

describe('metBurn', () => {
  test('MET × 3.5 × kg / 200 × minutes', () => {
    // 7 MET, 70kg, 30 min → 7 × 3.5 × 70 / 200 × 30 = 257.25
    expect(metBurn(7, 70, 30)).toBeCloseTo(257.25, 5);
  });

  test('zero minutes → zero', () => {
    expect(metBurn(7, 70, 0)).toBe(0);
  });
});

describe('stepsBurn', () => {
  test('9000 steps at 85kg ≈ 330 (spec worked example)', () => {
    // max(0, 9000−3000) × 0.045 × 85/70 = 6000 × 0.05464… ≈ 327.86
    expect(stepsBurn(9000, 85)).toBeCloseTo(327.857142857, 6);
  });

  test('2500 steps → exactly zero, not a small negative-looking number', () => {
    expect(stepsBurn(2500, 85)).toBe(0);
  });

  test('exactly 3000 steps → zero (baseline already contains them)', () => {
    expect(stepsBurn(3000, 70)).toBe(0);
  });

  test('scales with body weight', () => {
    expect(stepsBurn(10000, 70)).toBeCloseTo(7000 * 0.045, 6);
  });
});

describe('dayMovementBurn — the double-count rule', () => {
  test('steps + ambulatory exercise → max, loser marked included', () => {
    const r = dayMovementBurn(330, [{ kcal: 250, isAmbulatory: true }]);
    expect(r.total).toBe(330);
    expect(r.stepsIncluded).toBe(false);
    expect(r.ambulatoryIncluded).toBe(true);
  });

  test('ambulatory exercise larger than steps → exercise wins, steps included', () => {
    const r = dayMovementBurn(200, [{ kcal: 410, isAmbulatory: true }]);
    expect(r.total).toBe(410);
    expect(r.stepsIncluded).toBe(true);
    expect(r.ambulatoryIncluded).toBe(false);
  });

  test('non-ambulatory exercise adds on top, unaffected', () => {
    const r = dayMovementBurn(330, [
      { kcal: 250, isAmbulatory: true },
      { kcal: 180, isAmbulatory: false }, // weights
    ]);
    expect(r.total).toBe(330 + 180);
  });

  test('no steps entry → all exercise counts, nothing marked included', () => {
    const r = dayMovementBurn(null, [
      { kcal: 250, isAmbulatory: true },
      { kcal: 180, isAmbulatory: false },
    ]);
    expect(r.total).toBe(430);
    expect(r.stepsIncluded).toBe(false);
    expect(r.ambulatoryIncluded).toBe(false);
  });

  test('steps entry with zero burn + ambulatory walk → walk wins, steps included', () => {
    const r = dayMovementBurn(0, [{ kcal: 150, isAmbulatory: true }]);
    expect(r.total).toBe(150);
    expect(r.stepsIncluded).toBe(true);
    expect(r.ambulatoryIncluded).toBe(false);
  });

  test('steps alone, no exercise → steps count fully', () => {
    const r = dayMovementBurn(330, []);
    expect(r.total).toBe(330);
    expect(r.stepsIncluded).toBe(false);
    expect(r.ambulatoryIncluded).toBe(false);
  });

  test('multiple ambulatory exercises sum before comparing against steps', () => {
    // morning walk 150 + evening jog 250 = 400 > 330 steps burn
    const r = dayMovementBurn(330, [
      { kcal: 150, isAmbulatory: true },
      { kcal: 250, isAmbulatory: true },
    ]);
    expect(r.total).toBe(400);
    expect(r.stepsIncluded).toBe(true);
  });
});

describe('displayNet — the floor', () => {
  test('normal day passes through', () => {
    expect(displayNet(1800, 300)).toBe(1500);
  });

  test('never below 1200, however much was burned', () => {
    expect(displayNet(1400, 900)).toBe(1200);
  });

  test('20,000-step day does not unlock display calories below the floor', () => {
    expect(displayNet(1300, 1035)).toBe(1200);
  });

  test('true net clamps at 0 before the display floor applies', () => {
    expect(displayNet(200, 900)).toBe(1200);
  });
});

describe('isValidGoal', () => {
  test('rejects below 1200', () => {
    expect(isValidGoal(1199)).toBe(false);
    expect(isValidGoal(800)).toBe(false);
  });

  test('accepts 1200 and above', () => {
    expect(isValidGoal(1200)).toBe(true);
    expect(isValidGoal(2200)).toBe(true);
  });

  test('rejects non-integer garbage', () => {
    expect(isValidGoal(Number.NaN)).toBe(false);
    expect(isValidGoal(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('weightForCalc', () => {
  test('uses profile weight when present', () => {
    expect(weightForCalc({ weightKg: 82, weightIsAssumed: false })).toBe(82);
  });

  test('falls back to 65kg so exercise math does not crash', () => {
    expect(weightForCalc({ weightKg: null, weightIsAssumed: true })).toBe(65);
  });
});
