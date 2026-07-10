// Deterministic fast path, run after cache lookup and before the model.
// Only patterns spec/05 pins down exactly resolve here: steps parse, water
// constants, the ordered weight rules, explicit sleep durations. Everything
// else returns null and goes to the model. These never touch a food ref —
// picking a dish locally would be the nearest-neighbour guessing the spec
// bans. Input is always normalize() output.

import type { Resolution } from './types';

const LB_TO_KG = 0.453592;

export function lbsToKg(lbs: number): number {
  return Math.round(lbs * LB_TO_KG * 10) / 10;
}

function resolution(partial: Pick<Resolution, 'intent' | 'qty' | 'unit'>): Resolution {
  return { ...partial, ref: null, context: 'home', confidence: 1 };
}

const WATER_NOUN = '(?:water|paani|pani)';
const NUM = String.raw`(\d+(?:\.\d+)?)`;

/** First-person body phrasing (spec/05 weight rule 1), post-normalize. */
const FIRST_PERSON_WEIGHT = /\b(?:i weigh|i m at|my weight|weigh in)\b/;

function weightFrom(qty: number, unit: string | undefined): Resolution | null {
  // Unitless first-person mass assumes kg — FLAG(nirmal): "i weigh 150"
  // could mean lbs, but Slate's users weigh in kg; 30-250 bounds it.
  const kg = unit === 'lb' || unit === 'lbs' ? lbsToKg(qty) : qty;
  if (kg < 30 || kg > 250) return null;
  return resolution({ intent: 'weight', qty: kg, unit: 'kg' });
}

export function localRules(normalized: string): Resolution | null {
  // Steps: integer + step noun, k = thousands. Nothing else on the line.
  const steps = normalized.match(new RegExp(`^${NUM}(k)?\\s*steps?$`));
  if (steps) {
    const qty = Math.round(Number(steps[1]) * (steps[2] ? 1000 : 1));
    return qty > 0 && qty <= 100000 ? resolution({ intent: 'steps', qty, unit: 'steps' }) : null;
  }

  // Water: qty + unit + water noun, or the bare noun (one glass).
  const water = normalized.match(new RegExp(`^${NUM} (glass|ml|l) (?:of )?${WATER_NOUN}$`));
  if (water) {
    const qty = Number(water[1]);
    const unit = water[2] as 'glass' | 'ml' | 'l';
    const cap = unit === 'glass' ? 50 : unit === 'l' ? 20 : 20000;
    return qty > 0 && qty <= cap ? resolution({ intent: 'water', qty, unit }) : null;
  }
  if (new RegExp(`^${WATER_NOUN}$`).test(normalized)) {
    return resolution({ intent: 'water', qty: 1, unit: 'glass' });
  }

  // Weight rule 1: first-person phrasing + a mass anywhere in the line.
  if (FIRST_PERSON_WEIGHT.test(normalized)) {
    const mass = normalized.match(new RegExp(`${NUM}\\s*(kg|lb|lbs)?\\b`));
    if (mass) return weightFrom(Number(mass[1]), mass[2]);
    return null;
  }

  // "weight 85" is a weigh-in (MASTER: weight is a journal line). Anchored,
  // so "weight training 45 minutes" never matches.
  const weighIn = normalized.match(new RegExp(`^weight ${NUM}(?: kg)?$`));
  if (weighIn) return weightFrom(Number(weighIn[1]), 'kg');

  // Weight rule 2: bare mass, whole line, 30-250 kg. "2 kg chicken" has a
  // trailing noun and falls through (rule 3); a bare integer never matches
  // (rule 4).
  const bareMass = normalized.match(new RegExp(`^${NUM} ?(kg|lb|lbs)$`));
  if (bareMass) return weightFrom(Number(bareMass[1]), bareMass[2]);

  // Sleep: explicit duration only. "slept badly" is the model's problem.
  const sleep =
    normalized.match(new RegExp(`^(?:slept|sleep) ${NUM} hours$`)) ??
    normalized.match(new RegExp(`^${NUM} hours sleep$`));
  if (sleep) {
    const qty = Number(sleep[1]);
    return qty > 0 && qty <= 24 ? resolution({ intent: 'sleep', qty, unit: 'hours' }) : null;
  }

  return null;
}
