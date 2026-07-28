// Dishes + exercises → idempotent seed SQL (spec/06 layer 2). Pure; no I/O —
// seed-reference.mjs does the reading and writing.
//
// Layer 1 (ingredients) is IFCT and arrives via scripts/ifct-import.mjs. This
// is layer 2: the recipes composed from those ingredients, and the exercise
// MET table. Both are reference data, shared by every user, and both are
// regenerated from the reviewed .json rather than hand-edited as SQL — every
// number keeps its lineage back to a row someone ruled on (MASTER: the dish
// table is not delegable to a model).
//
// The SQL is safe to apply repeatedly: upsert on the primary key, and for
// dish_ingredients a delete of rows the recipe no longer contains, so a
// corrected recipe cannot leave an orphan ingredient behind silently adding
// calories.

import { sqlLit } from '../ifct/parse.mjs';

/** Postgres text[] literal. Empty array is `'{}'` — never null, the column is scanned. */
function pgTextArray(values) {
  if (!values || values.length === 0) return `'{}'::text[]`;
  return `array[${values.map((v) => sqlLit(v)).join(', ')}]::text[]`;
}

function bool(value) {
  return value ? 'true' : 'false';
}

/**
 * Structural checks that must hold before anything is written. These are the
 * failures that would otherwise surface as a Postgres error mid-apply, or —
 * worse — as a silently wrong number in someone's journal.
 */
export function validateDishes(dishes, refMap, knownIngredientIds) {
  const errors = [];
  const seenIds = new Set();
  const seenAliases = new Map();

  for (const dish of dishes) {
    if (!dish.id || !dish.name) {
      errors.push(`dish missing id/name: ${JSON.stringify(dish).slice(0, 80)}`);
      continue;
    }
    if (seenIds.has(dish.id)) errors.push(`${dish.id}: duplicate dish id`);
    seenIds.add(dish.id);

    if (!Array.isArray(dish.ingredients) || dish.ingredients.length === 0) {
      errors.push(`${dish.id}: no ingredients — a dish with no recipe has no lineage`);
    }
    if (typeof dish.default_qty !== 'number' || dish.default_qty <= 0) {
      errors.push(`${dish.id}: default_qty must be a positive number`);
    }
    if (!dish.default_unit) errors.push(`${dish.id}: default_unit missing`);
    // A volume unit means the served weight comes from the katori/glass, not
    // from the raw recipe — without serving_g the engine would scale a served
    // weight against a dry basis and multiply the dish (see units.ts).
    if (
      ['katori', 'cup', 'glass', 'ml', 'l'].includes(dish.default_unit) &&
      !('serving_g' in dish)
    ) {
      errors.push(
        `${dish.id}: a ${dish.default_unit}-default dish must declare serving_g — a number, ` +
          `or null with a note saying why the recipe grams are already the served grams`,
      );
    }
    if (dish.serving_g != null && (typeof dish.serving_g !== 'number' || dish.serving_g <= 0)) {
      errors.push(`${dish.id}: serving_g must be a positive number or null`);
    }

    const seenRefs = new Set();
    for (const di of dish.ingredients ?? []) {
      const mapped = refMap[di.ref];
      // dish_ingredients is keyed (dish_id, ingredient_id): the same ingredient
      // listed twice would silently collapse to whichever row inserted last.
      if (seenRefs.has(di.ref)) errors.push(`${dish.id}: ingredient "${di.ref}" listed twice`);
      seenRefs.add(di.ref);
      if (!mapped) errors.push(`${dish.id}: ingredient "${di.ref}" is not in the ref map`);
      else if (!knownIngredientIds.has(mapped))
        errors.push(`${dish.id}: "${di.ref}" → ${mapped}, which is not an imported ingredient`);
      if (typeof di.grams !== 'number' || di.grams <= 0)
        errors.push(`${dish.id}: "${di.ref}" grams must be a positive number`);
    }

    // Two dishes answering to the same alias makes the resolver's choice
    // arbitrary — and the user sees a different number for the same words.
    for (const alias of dish.aliases ?? []) {
      const key = alias.trim().toLowerCase();
      const owner = seenAliases.get(key);
      if (owner) errors.push(`alias "${alias}" claimed by both ${owner} and ${dish.id}`);
      else seenAliases.set(key, dish.id);
    }
  }
  return errors;
}

export function validateExercises(exercises) {
  const errors = [];
  const seenIds = new Set();
  const seenAliases = new Map();
  for (const ex of exercises) {
    if (!ex.id || !ex.name) {
      errors.push(`exercise missing id/name: ${JSON.stringify(ex).slice(0, 80)}`);
      continue;
    }
    if (seenIds.has(ex.id)) errors.push(`${ex.id}: duplicate exercise id`);
    seenIds.add(ex.id);
    // MET 1 is lying still; past ~23 is elite sprinting. Outside that band it
    // is a typo, and a typo here becomes phantom calories in a budget.
    if (typeof ex.met !== 'number' || ex.met < 1 || ex.met > 23)
      errors.push(`${ex.id}: met ${ex.met} outside the plausible 1–23 band`);
    if (ex.unit !== 'minutes' && ex.unit !== 'km')
      errors.push(`${ex.id}: unit must be 'minutes' or 'km' (spec/06), got ${ex.unit}`);
    if (typeof ex.is_ambulatory !== 'boolean')
      errors.push(`${ex.id}: is_ambulatory must be a boolean — it drives the steps rule`);
    for (const alias of ex.aliases ?? []) {
      const key = alias.trim().toLowerCase();
      const owner = seenAliases.get(key);
      if (owner) errors.push(`alias "${alias}" claimed by both ${owner} and ${ex.id}`);
      else seenAliases.set(key, ex.id);
    }
  }
  return errors;
}

/**
 * dishes + dish_ingredients, in one transaction. Ingredient rows the recipe no
 * longer lists are deleted for the dishes in this file only — a dish absent
 * from the seed is left alone, because custom or region packs may add rows we
 * don't own here.
 */
export function dishesToSql(dishes, refMap) {
  const dishCols = [
    'id',
    'name',
    'region',
    'aliases',
    'default_unit',
    'default_qty',
    'is_home_cookable',
    'cooking_fat_ml',
    'serving_g',
  ];
  const dishValues = dishes
    .map(
      (d) =>
        `  (${sqlLit(d.id)}, ${sqlLit(d.name)}, ${sqlLit(d.region ?? null)}, ` +
        `${pgTextArray(d.aliases)}, ${sqlLit(d.default_unit)}, ${sqlLit(d.default_qty)}, ` +
        `${bool(d.is_home_cookable)}, ${sqlLit(d.cooking_fat_ml ?? null)}, ` +
        `${sqlLit(d.serving_g ?? null)})`,
    )
    .join(',\n');
  const dishUpdates = dishCols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  const pairs = [];
  for (const d of dishes)
    for (const di of d.ingredients) pairs.push([d.id, refMap[di.ref], di.grams, di.ref]);

  const ingredientValues = pairs
    .map(
      ([dishId, ingredientId, grams, ref]) =>
        // the ref is kept as a comment: the json says "potato", the table says
        // IFCT_F006, and a reviewer reading this file needs both.
        `  (${sqlLit(dishId)}, ${sqlLit(ingredientId)}, ${sqlLit(grams)})  -- ${ref}`,
    )
    .join(',\n');

  // Wrapped one per line: this file is read by a human reviewing a recipe
  // change, and a 4,000-character line is not reviewable.
  const keepList = pairs
    .map(([dishId, ingredientId]) => `         (${sqlLit(dishId)}, ${sqlLit(ingredientId)})`)
    .join(',\n');
  const dishIdList = dishes.map((d) => `         ${sqlLit(d.id)}`).join(',\n');

  return (
    `-- generated by scripts/seed-reference.mjs — do not edit by hand\n` +
    `-- source: supabase/seed/dishes.draft.json + scripts/ifct/ref-map.json\n` +
    `begin;\n\n` +
    `insert into dishes (${dishCols.join(', ')})\nvalues\n${dishValues}\n` +
    `on conflict (id) do update set ${dishUpdates};\n\n` +
    `insert into dish_ingredients (dish_id, ingredient_id, grams)\nvalues\n${ingredientValues}\n` +
    `on conflict (dish_id, ingredient_id) do update set grams = excluded.grams;\n\n` +
    `-- drop ingredients a corrected recipe no longer contains\n` +
    `delete from dish_ingredients\n` +
    ` where dish_id in (\n${dishIdList}\n       )\n` +
    `   and (dish_id, ingredient_id) not in (\n${keepList}\n       );\n\n` +
    `commit;\n`
  );
}

export function exercisesToSql(exercises) {
  const cols = ['id', 'name', 'aliases', 'met', 'unit', 'is_ambulatory'];
  const values = exercises
    .map(
      (e) =>
        `  (${sqlLit(e.id)}, ${sqlLit(e.name)}, ${pgTextArray(e.aliases)}, ` +
        `${sqlLit(e.met)}, ${sqlLit(e.unit)}, ${bool(e.is_ambulatory)})`,
    )
    .join(',\n');
  const updates = cols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  return (
    `-- generated by scripts/seed-reference.mjs — do not edit by hand\n` +
    `-- source: supabase/seed/exercises.draft.json\n` +
    `insert into exercises (${cols.join(', ')})\nvalues\n${values}\n` +
    `on conflict (id) do update set ${updates};\n`
  );
}

/** Ingredient ids from a generated 01_ingredients.sql — the set a dish ref may point at. */
export function ingredientIdsFromSql(sql) {
  const ids = new Set();
  for (const match of sql.matchAll(/^\s*\('([A-Za-z0-9_]+)',/gm)) ids.add(match[1]);
  return ids;
}
