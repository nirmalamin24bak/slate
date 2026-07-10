import { describe, expect, test } from 'vitest';
import { chaiKcal, coffeeKcal, dailyOilMlPerPerson, oilShares } from './kitchen';
import type { Kitchen } from './types';

const kitchen: Kitchen = {
  katoriMl: 200,
  rotiG: 35,
  oilBottleMl: 1000,
  oilBottleDays: 30,
  householdSize: 4,
  chaiSugarTsp: 1,
  chaiMilk: 'toned',
  coffeeSugarTsp: 1,
  coffeeMilk: 'toned',
};

describe('dailyOilMlPerPerson — the bottle heuristic', () => {
  test('1L over 30 days for 4 people ≈ 8.3 ml/person/day (spec worked example)', () => {
    expect(dailyOilMlPerPerson(kitchen)).toBeCloseTo(8.3333333, 5);
  });

  test('derived, never stored: responds to any input change', () => {
    expect(dailyOilMlPerPerson({ ...kitchen, householdSize: 2 })).toBeCloseTo(16.666666, 4);
    expect(dailyOilMlPerPerson({ ...kitchen, oilBottleDays: 15 })).toBeCloseTo(16.666666, 4);
  });
});

describe('oilShares — distribute the day’s oil across home-cooked entries', () => {
  test('proportional to base cooking_fat_ml weight', () => {
    expect(oilShares([5, 15])).toEqual([0.25, 0.75]);
  });

  test('single home-cooked entry takes the whole share', () => {
    expect(oilShares([8])).toEqual([1]);
  });

  test('null cooking fat weighs zero', () => {
    expect(oilShares([10, null, 10])).toEqual([0.5, 0, 0.5]);
  });

  test('no fat weights at all → all zero shares, no divide-by-zero', () => {
    expect(oilShares([null, 0])).toEqual([0, 0]);
    expect(oilShares([])).toEqual([]);
  });
});

describe('chaiKcal', () => {
  test('one sugar, toned milk ≈ 55 (5 + 35 + 16 = 56)', () => {
    expect(chaiKcal(kitchen)).toBe(56);
  });

  test('two sugars, full-fat milk (5 + 45 + 32 = 82)', () => {
    expect(chaiKcal({ ...kitchen, chaiSugarTsp: 2, chaiMilk: 'full' })).toBe(82);
  });

  test('black tea, no sugar → just the tea base', () => {
    expect(chaiKcal({ ...kitchen, chaiSugarTsp: 0, chaiMilk: 'none' })).toBe(5);
  });
});

describe('coffeeKcal', () => {
  test('one sugar, toned milk (2 + 35 + 16 = 53)', () => {
    expect(coffeeKcal(kitchen)).toBe(53);
  });

  test('black coffee, no sugar → just the coffee base', () => {
    expect(coffeeKcal({ ...kitchen, coffeeSugarTsp: 0, coffeeMilk: 'none' })).toBe(2);
  });

  test('filter coffee decoction: +5 kcal, 100ml milk assumed', () => {
    // 2 + 5 + (35/60)×100 + 16 = 81.333… (milk type for decoction is FLAG(nirmal))
    expect(coffeeKcal({ ...kitchen, coffeeMilk: 'decoction' })).toBeCloseTo(81.33333, 4);
  });
});
