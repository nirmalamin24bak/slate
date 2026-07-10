import { describe, expect, it } from 'vitest';

import type { Catalogue } from './types';
import { validateModelOutput } from './validate';

// spec/05 step 4 + the untrusted-LLM boundary (plan, both directions):
// strict JSON parse, ref must exist in the catalogue, qty positive and sane,
// confidence >= 0.6 else unresolved. A wrong match is worse than no match, so
// every failure collapses to `unresolved` — never a guess, never an exception.

const catalogue: Catalogue = {
  dishes: new Set(['dish_rajma', 'dish_poha_gujarati']),
  exercises: new Set(['ex_walk', 'ex_yoga']),
  packagedFoods: new Set(['8901234567890']),
  customDishes: new Set<string>(),
};

const food = {
  intent: 'food',
  ref: 'dish_rajma',
  qty: 1,
  unit: 'katori',
  context: 'home',
  confidence: 0.94,
};

function first(raw: string) {
  const out = validateModelOutput(raw, catalogue);
  expect(out).toHaveLength(1);
  return out[0]!;
}

describe('validateModelOutput — parse', () => {
  it('accepts a single JSON object', () => {
    expect(first(JSON.stringify(food))).toEqual(food);
  });

  it('accepts a JSON array as multiple resolutions', () => {
    const out = validateModelOutput(JSON.stringify([food, food]), catalogue);
    expect(out).toHaveLength(2);
    expect(out[1]!.intent).toBe('food');
  });

  it('prose → unresolved, never regexed', () => {
    expect(first('That looks like rajma, about 220 kcal').intent).toBe('unresolved');
  });

  it('markdown-fenced JSON → unresolved (strict parse, no fence stripping)', () => {
    expect(first('```json\n' + JSON.stringify(food) + '\n```').intent).toBe('unresolved');
  });

  it('non-object JSON → unresolved', () => {
    expect(first('42').intent).toBe('unresolved');
    expect(first('"rajma"').intent).toBe('unresolved');
  });

  it('an empty array → a single unresolved (the model returned nothing usable)', () => {
    const out = validateModelOutput('[]', catalogue);
    expect(out).toHaveLength(1);
    expect(out[0]!.intent).toBe('unresolved');
  });

  it('a non-object entry inside an array → that entry is unresolved', () => {
    const out = validateModelOutput(JSON.stringify([food, 42]), catalogue);
    expect(out).toHaveLength(2);
    expect(out[0]!.intent).toBe('food');
    expect(out[1]!.intent).toBe('unresolved');
  });
});

describe('validateModelOutput — the catalogue gate', () => {
  it('invented ref → unresolved (zero wrong-ref tolerance)', () => {
    expect(first(JSON.stringify({ ...food, ref: 'dish_invented' })).intent).toBe('unresolved');
  });

  it('exercise ref must be an exercise, not a dish', () => {
    const ex = { ...food, intent: 'exercise', ref: 'dish_rajma', unit: 'minutes' };
    expect(first(JSON.stringify(ex)).intent).toBe('unresolved');
  });

  it('packaged food barcode ref resolves', () => {
    const p = { ...food, ref: '8901234567890' };
    expect(first(JSON.stringify(p)).ref).toBe('8901234567890');
  });

  it('food with null ref → unresolved', () => {
    expect(first(JSON.stringify({ ...food, ref: null })).intent).toBe('unresolved');
  });
});

describe('validateModelOutput — confidence', () => {
  it('confidence below 0.6 → unresolved', () => {
    expect(first(JSON.stringify({ ...food, confidence: 0.59 })).intent).toBe('unresolved');
  });

  it('confidence 0.6 exactly passes', () => {
    expect(first(JSON.stringify({ ...food, confidence: 0.6 })).intent).toBe('food');
  });

  it('confidence above 1 → unresolved (probabilities cannot exceed 1)', () => {
    expect(first(JSON.stringify({ ...food, confidence: 1.2 })).intent).toBe('unresolved');
  });

  it('missing or non-numeric confidence → unresolved', () => {
    expect(first(JSON.stringify({ ...food, confidence: undefined })).intent).toBe('unresolved');
    expect(first(JSON.stringify({ ...food, confidence: 'high' })).intent).toBe('unresolved');
  });
});

describe('validateModelOutput — qty and unit sanity', () => {
  it('zero, negative, or non-finite qty → unresolved', () => {
    expect(first(JSON.stringify({ ...food, qty: 0 })).intent).toBe('unresolved');
    expect(first(JSON.stringify({ ...food, qty: -2 })).intent).toBe('unresolved');
    expect(first(JSON.stringify({ ...food, qty: 'two' })).intent).toBe('unresolved');
  });

  it('unit outside the vocabulary for the intent → unresolved', () => {
    expect(first(JSON.stringify({ ...food, unit: 'bowl' })).intent).toBe('unresolved');
    const ex = {
      intent: 'exercise',
      ref: 'ex_walk',
      qty: 45,
      unit: 'katori',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(ex)).intent).toBe('unresolved');
  });

  it('absurd qty → unresolved', () => {
    const steps = {
      intent: 'steps',
      ref: null,
      qty: 999999,
      unit: 'steps',
      context: 'home',
      confidence: 0.95,
    };
    expect(first(JSON.stringify(steps)).intent).toBe('unresolved');
    const ex = {
      intent: 'exercise',
      ref: 'ex_walk',
      qty: 2000,
      unit: 'minutes',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(ex)).intent).toBe('unresolved');
  });

  it('exercise distance is capped at 300 km (ultra ok, farther is a typo)', () => {
    const ok = {
      intent: 'exercise',
      ref: 'ex_walk',
      qty: 42,
      unit: 'km',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(ok))).toMatchObject({ intent: 'exercise', qty: 42, unit: 'km' });
    const far = { ...ok, qty: 301 };
    expect(first(JSON.stringify(far)).intent).toBe('unresolved');
  });

  it('water is capped per unit: 20 l and 20000 ml, above → unresolved', () => {
    const litres = {
      intent: 'water',
      ref: null,
      qty: 20,
      unit: 'l',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(litres))).toMatchObject({ intent: 'water', qty: 20, unit: 'l' });
    expect(first(JSON.stringify({ ...litres, qty: 21 })).intent).toBe('unresolved');
    const ml = {
      intent: 'water',
      ref: null,
      qty: 500,
      unit: 'ml',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(ml))).toMatchObject({ intent: 'water', qty: 500, unit: 'ml' });
    expect(first(JSON.stringify({ ...ml, qty: 20001 })).intent).toBe('unresolved');
  });

  it('water in glasses is capped at 50', () => {
    const glass = {
      intent: 'water',
      ref: null,
      qty: 51,
      unit: 'glass',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(glass)).intent).toBe('unresolved');
  });

  it('food past its 10000 cap → unresolved', () => {
    expect(first(JSON.stringify({ ...food, qty: 10001, unit: 'g' })).intent).toBe('unresolved');
  });
});

describe('validateModelOutput — non-food intents', () => {
  it('weight: ref forced null, kg passes', () => {
    const w = {
      intent: 'weight',
      ref: 'dish_rajma',
      qty: 85,
      unit: 'kg',
      context: 'home',
      confidence: 0.97,
    };
    const r = first(JSON.stringify(w));
    expect(r).toMatchObject({ intent: 'weight', ref: null, qty: 85, unit: 'kg' });
  });

  it('weight in lbs converts to canonical kg at this boundary', () => {
    const w = {
      intent: 'weight',
      ref: null,
      qty: 150,
      unit: 'lbs',
      context: 'home',
      confidence: 0.97,
    };
    const r = first(JSON.stringify(w));
    expect(r.unit).toBe('kg');
    expect(r.qty).toBeCloseTo(68, 0);
  });

  it('weight written as "pounds" converts the same way', () => {
    const w = {
      intent: 'weight',
      ref: null,
      qty: 150,
      unit: 'pounds',
      context: 'home',
      confidence: 0.97,
    };
    const r = first(JSON.stringify(w));
    expect(r.unit).toBe('kg');
    expect(r.qty).toBeCloseTo(68, 0);
  });

  it('weight outside human bounds → unresolved', () => {
    const w = {
      intent: 'weight',
      ref: null,
      qty: 900,
      unit: 'kg',
      context: 'home',
      confidence: 0.97,
    };
    expect(first(JSON.stringify(w)).intent).toBe('unresolved');
  });

  it('water in glasses passes; steps require the steps unit', () => {
    const water = {
      intent: 'water',
      ref: null,
      qty: 2,
      unit: 'glass',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(water)).intent).toBe('water');
    const steps = {
      intent: 'steps',
      ref: null,
      qty: 9000,
      unit: 'km',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(steps)).intent).toBe('unresolved');
  });

  it('steps in the steps unit pass', () => {
    const steps = {
      intent: 'steps',
      ref: null,
      qty: 9000,
      unit: 'steps',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(steps))).toMatchObject({
      intent: 'steps',
      qty: 9000,
      unit: 'steps',
    });
  });

  it('sleep may carry no duration ("slept badly")', () => {
    const s = {
      intent: 'sleep',
      ref: null,
      qty: null,
      unit: null,
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(s)).intent).toBe('sleep');
  });

  it('sleep with an explicit duration passes in hours or minutes', () => {
    const hours = {
      intent: 'sleep',
      ref: null,
      qty: 8,
      unit: 'hours',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(hours))).toMatchObject({ intent: 'sleep', qty: 8, unit: 'hours' });
    const minutes = {
      intent: 'sleep',
      ref: null,
      qty: 420,
      unit: 'minutes',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(minutes))).toMatchObject({
      intent: 'sleep',
      qty: 420,
      unit: 'minutes',
    });
  });

  it('sleep hours past a day → unresolved', () => {
    const s = {
      intent: 'sleep',
      ref: null,
      qty: 25,
      unit: 'hours',
      context: 'home',
      confidence: 0.9,
    };
    expect(first(JSON.stringify(s)).intent).toBe('unresolved');
  });
});

describe('validateModelOutput — context', () => {
  it('invalid or missing context defaults to home', () => {
    expect(first(JSON.stringify({ ...food, context: 'dhaba' })).context).toBe('home');
    expect(first(JSON.stringify({ ...food, context: undefined })).context).toBe('home');
  });

  it('outside is preserved', () => {
    expect(first(JSON.stringify({ ...food, context: 'outside' })).context).toBe('outside');
  });

  it('unknown intent → unresolved', () => {
    expect(first(JSON.stringify({ ...food, intent: 'mood' })).intent).toBe('unresolved');
  });
});
