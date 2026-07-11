// Bounded numeric parsing for user-typed fields. keyboardType is a hint, not a
// guarantee — iOS numeric keyboards still admit '.', '-', and paste bypasses
// them entirely. Number("1.2.3") is NaN, Number("-50") is -50, and either one
// flowing into the profile corrupts the BMR baseline for the life of the
// account. Every free-text numeric input clamps here, at the input boundary.

export interface Bounds {
  readonly min: number;
  readonly max: number;
  /** true → reject any non-integer (age, steps); false → allow decimals (weight). */
  readonly integer?: boolean;
}

/**
 * Parse a typed string to a number within bounds, or null if empty/invalid.
 * Rejects NaN, Infinity, out-of-range, and (when integer) non-integers.
 */
export function parseBounded(raw: string, bounds: Bounds): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (bounds.integer && !Number.isInteger(n)) return null;
  if (n < bounds.min || n > bounds.max) return null;
  return n;
}

// Field bounds. Shared so onboarding and the journal weight prompt agree.
export const BOUNDS = {
  age: { min: 13, max: 100, integer: true },
  heightCm: { min: 90, max: 250 },
  weightKg: { min: 30, max: 250 },
  oilBottleDays: { min: 1, max: 365, integer: true },
  householdSize: { min: 1, max: 20, integer: true },
} as const satisfies Record<string, Bounds>;
