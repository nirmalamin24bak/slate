// Public surface of the db layer (spec/04). SQLite is the read source,
// Supabase is truth. Pure SQL + mapping; expo.ts is the only native import.

export { runTransaction } from './adapter';
export type { SqlAdapter, SqlValue } from './adapter';
export { adoptPendingUser, PENDING_USER_ID } from './adoption';
export { sqliteCacheStore } from './cacheStore';
export {
  getEntry,
  insertEntry,
  listDay,
  listDirtyEntries,
  listRecents,
  listResolving,
  listRetryable,
  listSavedFoods,
  markEntriesSynced,
  nextPosition,
  patchEntry,
} from './entriesRepo';
export type { EntryPatch } from './entriesRepo';
export {
  ensureUserRows,
  flushOnboarding,
  getKitchen,
  getProfile,
  listDirtyWeights,
  markWeightsSynced,
  patchKitchen,
  patchProfile,
  upsertWeight,
} from './profileRepo';
export type { KitchenPatch, ProfilePatch } from './profileRepo';
export {
  getExercise,
  getPackagedFood,
  loadCatalogue,
  loadDish,
  replaceDishes,
  replaceExercises,
  replaceIngredients,
  replacePackagedFoods,
} from './referenceRepo';
export { migrate, SCHEMA_VERSION } from './schema';
export { pullReference, pushDirty } from './sync';
export type { RemoteDb } from './sync';
export type {
  DishIngredientJoined,
  DishRowJoined,
  EntryRow,
  EntryStatus,
  ExerciseRow,
  KitchenRow,
  PackagedFoodRow,
  ProfileRow,
  WeightRow,
} from './rows';
export { toDish, toKitchen } from './rows';
