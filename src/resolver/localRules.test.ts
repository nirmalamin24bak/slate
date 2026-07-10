import { describe, expect, it } from 'vitest';

import { localRules } from './localRules';

// Deterministic pre-model resolutions for patterns spec/05 defines exactly:
// steps parse (8k → 8000), water constants, the ordered weight rules, tight
// sleep durations. Anything not matched verbatim returns null and goes to the
// model — a local rule that guesses is worse than no local rule.
// Input is ALWAYS normalize() output.

describe('localRules — steps (spec/05: integer + step noun; k = thousands)', () => {
  it('parses bare steps lines', () => {
    expect(localRules('9000 steps')).toMatchObject({ intent: 'steps', qty: 9000, unit: 'steps' });
    expect(localRules('8k steps')).toMatchObject({ intent: 'steps', qty: 8000 });
    expect(localRules('12000 steps')).toMatchObject({ intent: 'steps', qty: 12000 });
  });

  it('leaves prose around steps to the model', () => {
    expect(localRules('walked 9000 steps today')).toBeNull();
  });

  it('rejects an absurd step count (>100000 is a typo, not a day)', () => {
    expect(localRules('200000 steps')).toBeNull();
    expect(localRules('200k steps')).toBeNull();
  });

  it('rejects a zero step count', () => {
    expect(localRules('0 steps')).toBeNull();
  });
});

describe('localRules — water (1 glass = 250ml constant, spec/05)', () => {
  it('resolves qty + unit + water noun', () => {
    expect(localRules('2 glass water')).toMatchObject({ intent: 'water', qty: 2, unit: 'glass' });
    expect(localRules('500 ml water')).toMatchObject({ intent: 'water', qty: 500, unit: 'ml' });
    expect(localRules('1 l paani')).toMatchObject({ intent: 'water', qty: 1, unit: 'l' });
  });

  it('bare water noun is one glass', () => {
    expect(localRules('water')).toMatchObject({ intent: 'water', qty: 1, unit: 'glass' });
    expect(localRules('paani')).toMatchObject({ intent: 'water', qty: 1, unit: 'glass' });
  });

  it('quantity without a water noun is not water', () => {
    expect(localRules('2 glass')).toBeNull(); // could be lassi
  });

  it('rejects water quantities past each unit cap', () => {
    expect(localRules('60 glass water')).toBeNull(); // glass cap 50
    expect(localRules('25 l water')).toBeNull(); // l cap 20
    expect(localRules('30000 ml water')).toBeNull(); // ml cap 20000
  });

  it('rejects a zero water quantity', () => {
    expect(localRules('0 glass water')).toBeNull();
  });
});

describe('localRules — weight (spec/05 ordered rules)', () => {
  it('rule 1: first-person body phrasing wins', () => {
    expect(localRules('i weigh 85 kg')).toMatchObject({ intent: 'weight', qty: 85, unit: 'kg' });
    expect(localRules('i m at 68 kg')).toMatchObject({ intent: 'weight', qty: 68 });
    expect(localRules('my weight is 72 kg')).toMatchObject({ intent: 'weight', qty: 72 });
    expect(localRules('weekly weigh in is 130 lbs')).toMatchObject({
      intent: 'weight',
      unit: 'kg',
    });
  });

  it('converts first-person lbs to kg', () => {
    const r = localRules('i weigh 150 lbs');
    expect(r?.qty).toBeCloseTo(68, 0);
    expect(r?.unit).toBe('kg');
  });

  it('rule 1: first-person phrasing without a number falls through to the model', () => {
    expect(localRules('my weight is up')).toBeNull();
    expect(localRules('i weigh myself daily')).toBeNull();
  });

  it('anchored "weight N" line is a weigh-in, "weight training" is not', () => {
    expect(localRules('weight 85')).toMatchObject({ intent: 'weight', qty: 85 });
    expect(localRules('weight training 45 minutes')).toBeNull();
  });

  it('weight bounds are inclusive at 30 and 250 kg', () => {
    expect(localRules('30 kg')).toMatchObject({ intent: 'weight', qty: 30 });
    expect(localRules('250 kg')).toMatchObject({ intent: 'weight', qty: 250 });
    expect(localRules('29 kg')).toBeNull();
    expect(localRules('251 kg')).toBeNull();
  });

  it('rule 2: bare mass is weight only in 30-250 kg', () => {
    expect(localRules('85 kg')).toMatchObject({ intent: 'weight', qty: 85 });
    expect(localRules('2 kg')).toBeNull();
    expect(localRules('300 kg')).toBeNull();
  });

  it('rule 3: a food noun beside the mass means food, not weight', () => {
    expect(localRules('85 kg chicken')).toBeNull(); // model decides; rules never guess food refs
    expect(localRules('2 kg chicken')).toBeNull();
  });

  it('rule 4: a bare integer is never weight', () => {
    expect(localRules('85')).toBeNull();
  });
});

describe('localRules — sleep (tight patterns only)', () => {
  it('parses explicit durations', () => {
    expect(localRules('slept 8 hours')).toMatchObject({ intent: 'sleep', qty: 8, unit: 'hours' });
    expect(localRules('8 hours sleep')).toMatchObject({ intent: 'sleep', qty: 8, unit: 'hours' });
  });

  it('leaves sleep quality prose to the model', () => {
    expect(localRules('slept badly')).toBeNull();
  });

  it('rejects sleep durations past a day', () => {
    expect(localRules('slept 25 hours')).toBeNull();
    expect(localRules('30 hours sleep')).toBeNull();
  });

  it('rejects a zero sleep duration', () => {
    expect(localRules('slept 0 hours')).toBeNull();
  });
});

describe('localRules — everything else falls through', () => {
  it('food lines return null', () => {
    expect(localRules('2 roti')).toBeNull();
    expect(localRules('1 katori dal')).toBeNull();
    expect(localRules('45 minutes walk')).toBeNull();
  });

  it('local resolutions carry confidence 1 and home context', () => {
    expect(localRules('9000 steps')).toMatchObject({ confidence: 1, context: 'home', ref: null });
  });
});
