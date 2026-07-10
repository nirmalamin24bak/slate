// Public surface of the nutrition engine (spec/06). Pure functions only —
// no React Native, no network, no database. The db layer feeds it rows.

export * from './constants';
export * from './types';
export {
  baseline,
  bmr,
  dayMovementBurn,
  displayNet,
  isValidGoal,
  metBurn,
  stepsBurn,
  weightForCalc,
} from './energy';
export type { BmrInput, ExerciseBurn, MovementBurn, WeightSource } from './energy';
export { chaiKcal, coffeeKcal, dailyOilMlPerPerson, oilShares } from './kitchen';
export { addOil, scale, sumIngredients, zeroNutrition } from './nutrition';
export { applyPersonalization, clampFatFactor, clampTotalFactor } from './personalization';
export { recipeTotalGrams, toGrams } from './units';
export { computeEntry } from './computeEntry';
export type { ComputeEntryInput } from './computeEntry';
