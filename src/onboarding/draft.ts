// Onboarding draft (spec/02 §A) — pure. Everything the nine screens collect,
// held locally until Start, then flushed to profiles + kitchen in one
// transaction (spec/09: possibly before a session exists).
//
// Skips behave exactly as specced: no fabricated BMR, population medians on
// kitchen, `is_assumed` flags everywhere a default stands in for an answer.

import { ASSUMED_WEIGHT_KG } from '../engine/constants';
import { baseline, bmr, isValidGoal } from '../engine/energy';
import type { KitchenPatch, ProfilePatch } from '../db/profileRepo';
import type { MilkKind } from '../engine/types';

export interface BodyDraft {
  age: number | null;
  sex: 'male' | 'female' | null;
  heightCm: number | null;
  weightKg: number | null;
  skipped: boolean;
}

export interface KitchenDraft {
  katoriMl: 150 | 200 | 250;
  rotiG: 25 | 35 | 50;
  oilBottleDays: number;
  householdSize: number;
  chaiSugarTsp: 0 | 1 | 2;
  chaiMilk: MilkKind | 'decoction';
  skipped: boolean;
}

export interface OnboardingDraft {
  body: BodyDraft;
  kitchen: KitchenDraft;
  calorieGoal: number | null;
  remindersEnabled: boolean;
}

/** Population medians (spec/02 O7): 200ml katori, 8″ roti, 30g/day oil, 1 tsp, toned. */
export const DEFAULT_DRAFT: OnboardingDraft = {
  body: { age: null, sex: null, heightCm: null, weightKg: null, skipped: false },
  kitchen: {
    katoriMl: 200,
    rotiG: 35,
    oilBottleDays: 30,
    householdSize: 4,
    chaiSugarTsp: 1,
    chaiMilk: 'toned',
    skipped: false,
  },
  calorieGoal: null,
  remindersEnabled: false,
};

// --- unit conversion, at the input boundary and nowhere else (CLAUDE.md) ---

export function cmFromFtIn(feet: number, inches: number): number {
  return Math.round((feet * 12 + inches) * 2.54 * 10) / 10;
}

export function ftInFromCm(cm: number): { feet: number; inches: number } {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: Math.round(totalInches - feet * 12) };
}

// --- O6 preview: two numbers and no advice ---

export interface BmrPreview {
  bmr: number | null;
  baseline: number | null;
}

/** Null everywhere the engine refuses (skip, missing fields, under-18 DPDP). */
export function bmrPreview(body: BodyDraft): BmrPreview {
  if (body.skipped) return { bmr: null, baseline: null };
  const value = bmr({
    sex: body.sex,
    weightKg: body.weightKg,
    heightCm: body.heightCm,
    age: body.age,
  });
  return { bmr: value, baseline: baseline(value) };
}

// --- O8: the goal field rejects below 1,200 with a plain message ---

export const GOAL_REJECTION_MESSAGE = "Slate can't set a goal below 1,200 calories.";

export function validateGoal(raw: string): { goal: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { goal: null, error: null }; // empty is allowed — no goal
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { goal: null, error: null };
  if (!isValidGoal(value)) return { goal: null, error: GOAL_REJECTION_MESSAGE };
  return { goal: Math.round(value), error: null };
}

// --- the flush: draft → row patches ---

/**
 * Age is what O6 asks; profiles stores dob. Anchor the birthday `age` years
 * before `now` — accurate to within a year, which is all BMR needs.
 */
export function dobFromAge(age: number, now: Date): string {
  const dob = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  return dob.toISOString().slice(0, 10);
}

export function toProfilePatch(draft: OnboardingDraft, now: Date): ProfilePatch {
  const { body } = draft;
  const complete =
    !body.skipped &&
    body.age !== null &&
    body.sex !== null &&
    body.heightCm !== null &&
    body.weightKg !== null;

  if (!complete) {
    // On skip: fallback weight only so exercise math doesn't crash. Never a
    // fabricated BMR — sex/height/dob stay null.
    return {
      weight_kg: ASSUMED_WEIGHT_KG,
      weight_is_assumed: 1,
      calorie_goal: draft.calorieGoal,
    };
  }

  return {
    dob: dobFromAge(body.age as number, now),
    sex: body.sex,
    height_cm: body.heightCm,
    weight_kg: body.weightKg,
    weight_is_assumed: 0,
    calorie_goal: draft.calorieGoal,
  };
}

export function toKitchenPatch(draft: OnboardingDraft): KitchenPatch {
  const k = draft.kitchen;
  if (k.skipped) {
    // medians already sit in the schema defaults; just record the assumption
    return { is_assumed: 1 };
  }
  return {
    katori_ml: k.katoriMl,
    roti_g: k.rotiG,
    oil_bottle_ml: 1000,
    oil_bottle_days: k.oilBottleDays,
    household_size: k.householdSize,
    chai_sugar_tsp: k.chaiSugarTsp,
    chai_milk: k.chaiMilk === 'decoction' ? 'toned' : k.chaiMilk,
    coffee_sugar_tsp: k.chaiSugarTsp,
    coffee_milk: k.chaiMilk,
    is_assumed: 0,
  };
}
