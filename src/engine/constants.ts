// Engine constants — spec/06-NUTRITION-ENGINE.md. Every number here has a
// reason in the spec; change the spec before changing the number.

/** Displayed net calories never drop below this. One Math.max(). */
export const NET_FLOOR_KCAL = 1200;

/** ICMR-NIN 2020: international equations overestimate Indian BMR by 10–12%. */
export const BMR_INDIA_ADJUSTMENT = 0.9;

/** Sedentary. Never an activity multiplier — logged exercise subtracts explicitly. */
export const BASELINE_FACTOR = 1.2;

/** baseline = BMR × 1.2 already contains roughly the first 3,000 steps. */
export const STEPS_THRESHOLD = 3000;

/** Engineering default, not a measured constant. Flagged for revision on real data. */
export const KCAL_PER_STEP_AT_70KG = 0.045;

/** MASTER.md: on skip, fallback weight so exercise math does not crash. */
export const ASSUMED_WEIGHT_KG = 65;

/** DPDP: under-18 → no BMR, no numbers. */
export const MIN_AGE_FOR_NUMBERS = 18;

/** context='outside' → cooking fat × 1.35, portion × 1.20 (spec/05, spec/06). */
export const OUTSIDE_FAT_MULTIPLIER = 1.35;
export const OUTSIDE_PORTION_MULTIPLIER = 1.2;

/** Personalization is a bounded modifier: ±20% total, ±30% cooking fat. */
export const PERSONALIZATION_TOTAL_BOUND = 0.2;
export const PERSONALIZATION_FAT_BOUND = 0.3;

/**
 * Oil energy per ml. Derived from the spec's own arithmetic:
 * 8.3 ml/person/day ≈ 75 kcal/day → 9 kcal/ml (ml ≈ g simplification, fat 9 kcal/g).
 */
export const OIL_KCAL_PER_ML = 9;
/** Same simplification: 1 ml oil ≈ 1 g fat for macro accounting. */
export const OIL_FAT_G_PER_ML = 1;

/** Slate constants, not calibration fields (spec/06 Water). */
export const GLASS_ML = 250;
export const LITRE_ML = 1000;

/** Chai & coffee bases and additions, kcal (spec/06). */
export const TEA_BASE_KCAL = 5;
export const COFFEE_BASE_KCAL = 2;
export const SUGAR_TSP_KCAL = 16;
export const MILK_SERVING_ML = 60;
export const MILK_KCAL_PER_60ML = { none: 0, toned: 35, full: 45 } as const;
export const DECOCTION_EXTRA_KCAL = 5;
export const DECOCTION_MILK_ML = 100;

/** Kitchen units. tbsp/tsp are standard measures; cup is FLAG(nirmal): not in any spec. */
export const TBSP_ML = 15;
export const TSP_ML = 5;
// FLAG(nirmal): spec/05 lists 'cup' in the unit vocabulary but no spec defines its ml.
// 240 ml (standard measuring cup) used pending a decision.
export const CUP_ML = 240;

/** Stamped on every entry so a July recipe fix never rewrites a user's June. */
export const CALC_VERSION = 'engine-v1';
