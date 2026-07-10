import { describe, expect, test } from 'vitest';
import { applyPersonalization, clampFatFactor, clampTotalFactor } from './personalization';
import type { Nutrition } from './types';

// Personalization is a bounded modifier, not an authority (spec/05). Implemented
// as a clamp in the engine — not a prompt instruction the model can be argued out of.

const base: Nutrition = { kcal: 250, proteinG: 8, carbsG: 40, fatG: 7, fiberG: 3, sugarG: 2 };

describe('clampTotalFactor', () => {
  test('"everything I eat is 50 calories" → 0.8, a slightly leaner poha, not a lie', () => {
    expect(clampTotalFactor(0.1)).toBe(0.8);
  });

  test('upper bound 1.2', () => {
    expect(clampTotalFactor(1.5)).toBe(1.2);
  });

  test('within ±20% passes through', () => {
    expect(clampTotalFactor(0.9)).toBe(0.9);
    expect(clampTotalFactor(1.15)).toBe(1.15);
  });
});

describe('clampFatFactor', () => {
  test('cooking fat bounded to ±30%', () => {
    expect(clampFatFactor(0.2)).toBe(0.7);
    expect(clampFatFactor(3)).toBe(1.3);
    expect(clampFatFactor(1.25)).toBe(1.25);
  });
});

describe('applyPersonalization', () => {
  test('no factors → nutrition unchanged', () => {
    expect(applyPersonalization(base, null)).toEqual(base);
    expect(applyPersonalization(base, {})).toEqual(base);
  });

  test('total factor scales every field proportionally — consistency over precision', () => {
    const n = applyPersonalization(base, { total: 0.9 });
    expect(n.kcal).toBeCloseTo(225, 6);
    expect(n.proteinG).toBeCloseTo(7.2, 6);
    expect(n.fatG).toBeCloseTo(6.3, 6);
  });

  test('out-of-bound total is clamped before applying', () => {
    const n = applyPersonalization(base, { total: 0.01 });
    expect(n.kcal).toBeCloseTo(200, 6); // 250 × 0.8, never lower
  });

  test('fat factor is not applied here — it acts on cooking oil upstream', () => {
    const n = applyPersonalization(base, { fat: 0.7 });
    expect(n).toEqual(base);
  });
});
