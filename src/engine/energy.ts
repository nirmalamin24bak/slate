// Energy math — spec/06-NUTRITION-ENGINE.md. Pure, deterministic, no I/O.

import {
  ASSUMED_WEIGHT_KG,
  BASELINE_FACTOR,
  BMR_INDIA_ADJUSTMENT,
  KCAL_PER_STEP_AT_70KG,
  MIN_AGE_FOR_NUMBERS,
  NET_FLOOR_KCAL,
  STEPS_THRESHOLD,
} from './constants';

export interface BmrInput {
  sex: 'male' | 'female' | null;
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
}

/**
 * Mifflin-St Jeor × 0.90 (ICMR-NIN 2020). Returns null rather than fabricate:
 * unknown sex, missing measurements, or under-18 (DPDP) → no number at all.
 */
export function bmr({ sex, weightKg, heightCm, age }: BmrInput): number | null {
  if (sex === null || weightKg === null || heightCm === null || age === null) return null;
  if (age < MIN_AGE_FOR_NUMBERS) return null;
  const sexTerm = sex === 'male' ? 5 : -161;
  const raw = 10 * weightKg + 6.25 * heightCm - 5 * age + sexTerm;
  return raw * BMR_INDIA_ADJUSTMENT;
}

/** BMR × 1.2, sedentary, always. Exercise earns its credit by being logged. */
export function baseline(bmrKcal: number | null): number | null {
  return bmrKcal === null ? null : bmrKcal * BASELINE_FACTOR;
}

/** Compendium of Physical Activities: MET × 3.5 × kg / 200 × minutes. */
export function metBurn(met: number, weightKg: number, minutes: number): number {
  return ((met * 3.5 * weightKg) / 200) * minutes;
}

/** Only steps past the first 3,000 bill; the baseline already paid for those. */
export function stepsBurn(steps: number, weightKg: number): number {
  const billable = Math.max(0, steps - STEPS_THRESHOLD);
  return billable * KCAL_PER_STEP_AT_70KG * (weightKg / 70);
}

export interface ExerciseBurn {
  kcal: number;
  isAmbulatory: boolean;
}

export interface MovementBurn {
  total: number;
  /** true → the steps line renders ✓ `included`, not a number */
  stepsIncluded: boolean;
  /** true → the ambulatory exercise lines render ✓ `included` */
  ambulatoryIncluded: boolean;
}

/**
 * The double-count rule: 9000 steps and 45 min walk are one walk described
 * twice. Count max(steps, ambulatory); the smaller stays visible as `included`.
 * Non-ambulatory exercise adds on top. stepsBurnKcal null = no steps entry today.
 */
export function dayMovementBurn(
  stepsBurnKcal: number | null,
  exercises: readonly ExerciseBurn[],
): MovementBurn {
  const ambulatory = exercises.filter((e) => e.isAmbulatory).reduce((sum, e) => sum + e.kcal, 0);
  const nonAmbulatory = exercises
    .filter((e) => !e.isAmbulatory)
    .reduce((sum, e) => sum + e.kcal, 0);

  if (stepsBurnKcal === null) {
    return { total: ambulatory + nonAmbulatory, stepsIncluded: false, ambulatoryIncluded: false };
  }

  const hasAmbulatory = exercises.some((e) => e.isAmbulatory);
  const stepsWin = stepsBurnKcal >= ambulatory;
  return {
    total: Math.max(stepsBurnKcal, ambulatory) + nonAmbulatory,
    stepsIncluded: hasAmbulatory && !stepsWin,
    ambulatoryIncluded: hasAmbulatory && stepsWin,
  };
}

/** Store the true value, display the floor. Never celebrate a low net. */
export function displayNet(consumedKcal: number, burnedKcal: number): number {
  const net = Math.max(consumedKcal - burnedKcal, 0);
  return Math.max(net, NET_FLOOR_KCAL);
}

/** The goal field rejects anything below the floor. Plain message, no lecture. */
export function isValidGoal(goal: number): boolean {
  return Number.isFinite(goal) && goal >= NET_FLOOR_KCAL;
}

export interface WeightSource {
  weightKg: number | null;
  weightIsAssumed: boolean;
}

/** 65kg fallback exists only so exercise math doesn't crash. Never displayed as fact. */
export function weightForCalc({ weightKg }: WeightSource): number {
  return weightKg ?? ASSUMED_WEIGHT_KG;
}
