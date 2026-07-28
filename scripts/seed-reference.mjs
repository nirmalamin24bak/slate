#!/usr/bin/env node
// Reviewed dish + exercise json → supabase/seed/02_dishes.sql, 03_exercises.sql.
//
//   node scripts/seed-reference.mjs
//     [--dishes supabase/seed/dishes.draft.json]
//     [--exercises supabase/seed/exercises.draft.json]
//     [--ref-map scripts/ifct/ref-map.json]
//     [--ingredients supabase/seed/01_ingredients.sql]   ids to validate refs against
//     [--out-dir supabase/seed]
//     [--check]   validate and compare against what's on disk; write nothing
//
// --check is the CI mode: it fails if the committed SQL doesn't match what the
// json would generate, so the seed can never drift from the reviewed source.
//
// Apply order against a database is the file order: 01 ingredients, then 02
// dishes (foreign keys into ingredients), then 03 exercises.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  dishesToSql,
  exercisesToSql,
  ingredientIdsFromSql,
  validateDishes,
  validateExercises,
} from './seed/reference.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const checkOnly = process.argv.includes('--check');

const dishesPath = resolve(arg('dishes', 'supabase/seed/dishes.draft.json'));
const exercisesPath = resolve(arg('exercises', 'supabase/seed/exercises.draft.json'));
const refMapPath = resolve(arg('ref-map', 'scripts/ifct/ref-map.json'));
const ingredientsPath = resolve(arg('ingredients', 'supabase/seed/01_ingredients.sql'));
const outDir = resolve(arg('out-dir', 'supabase/seed'));

const dishes = JSON.parse(readFileSync(dishesPath, 'utf8'));
const exercises = JSON.parse(readFileSync(exercisesPath, 'utf8'));
const refMap = JSON.parse(readFileSync(refMapPath, 'utf8'));
const ingredientIds = ingredientIdsFromSql(readFileSync(ingredientsPath, 'utf8'));

if (ingredientIds.size === 0) {
  console.error(`✗ no ingredient ids parsed from ${ingredientsPath} — run the IFCT import first`);
  process.exit(1);
}

const errors = [...validateDishes(dishes, refMap, ingredientIds), ...validateExercises(exercises)];
if (errors.length > 0) {
  console.error(`✗ ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

const outputs = [
  ['02_dishes.sql', dishesToSql(dishes, refMap)],
  ['03_exercises.sql', exercisesToSql(exercises)],
];

let drift = false;
for (const [name, sql] of outputs) {
  const path = resolve(outDir, name);
  if (checkOnly) {
    let onDisk = null;
    try {
      onDisk = readFileSync(path, 'utf8');
    } catch {
      onDisk = null;
    }
    if (onDisk !== sql) {
      console.error(`✗ ${name} is stale — regenerate with: node scripts/seed-reference.mjs`);
      drift = true;
    } else {
      console.log(`✓ ${name} matches the reviewed json`);
    }
  } else {
    writeFileSync(path, sql, 'utf8');
    console.log(`wrote ${path}`);
  }
}

if (drift) process.exit(1);

console.log(
  `✓ ${dishes.length} dishes (${dishes.reduce((n, d) => n + d.ingredients.length, 0)} ingredient rows), ` +
    `${exercises.length} exercises, all refs resolve`,
);
