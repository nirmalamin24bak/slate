#!/usr/bin/env node
// IFCT 2017 → supabase/seed/01_ingredients.sql (spec/06 layer 1).
//
//   node scripts/ifct-import.mjs --input path/to/ifct2017.csv
//     [--mapping scripts/ifct/mapping.json]   header overrides, see DEFAULT_MAPPING
//     [--out supabase/seed/01_ingredients.sql]
//     [--supplemental scripts/ifct/supplemental.json]   non-IFCT rows (curd, toned milk, …)
//     [--dishes supabase/seed/dishes.draft.json --ref-map scripts/ifct/ref-map.json]
//
// Source path (unblocked 12 Jul 2026): npm @ifct2017/compositions@2.0.9 (MIT),
// vendored at scripts/ifct/data/ and converted by scripts/ifct/prepare-nodef.mjs.
// Full chain:  prepare-nodef.mjs → this script → supabase/seed/01_ingredients.sql.
// --supplemental appends documented non-IFCT rows (see supplemental.json notes):
// IFCT covers ingredients, so curd/toned-milk/sugar/bread/noodles/cream need
// label- or derivation-based values with lineage recorded per row.
// With --dishes, also verifies every dish ingredient ref maps to a known id.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_MAPPING,
  parseCsv,
  toIngredientRows,
  toSql,
  validateDishRefs,
} from './ifct/parse.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const input = arg('input');
if (!input) {
  console.error('usage: node scripts/ifct-import.mjs --input <ifct.csv> [--out <file.sql>]');
  process.exit(1);
}

const mapping = arg('mapping')
  ? { ...DEFAULT_MAPPING, ...JSON.parse(readFileSync(resolve(arg('mapping')), 'utf8')) }
  : DEFAULT_MAPPING;

const records = parseCsv(readFileSync(resolve(input), 'utf8'));
const rows = toIngredientRows(records, mapping);
console.log(`parsed ${rows.length} ingredients from ${input}`);

// Non-IFCT rows (curd, toned milk, sugar, …) ride along with explicit lineage
// notes in supplemental.json. Same shape and the same kcal sanity bound as the
// imported rows; the note stays in the json, not the table.
const supplementalPath = arg('supplemental');
if (supplementalPath) {
  const supplemental = JSON.parse(readFileSync(resolve(supplementalPath), 'utf8'));
  for (const s of supplemental) {
    if (!s.id || !s.name) throw new Error(`supplemental row missing id/name: ${JSON.stringify(s)}`);
    if (typeof s.kcal_100g !== 'number' || s.kcal_100g < 0 || s.kcal_100g > 950)
      throw new Error(`supplemental ${s.id}: kcal out of range`);
    rows.push({
      id: s.id,
      name: s.name,
      name_hi: s.name_hi ?? null,
      kcal_100g: s.kcal_100g,
      protein_100g: s.protein_100g,
      carbs_100g: s.carbs_100g,
      fat_100g: s.fat_100g,
      fiber_100g: s.fiber_100g ?? null,
      sugar_100g: s.sugar_100g ?? null,
    });
  }
  console.log(`appended ${supplemental.length} supplemental ingredients from ${supplementalPath}`);
}

const out = resolve(arg('out') ?? 'supabase/seed/01_ingredients.sql');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toSql(rows), 'utf8');
console.log(`wrote ${out}`);

const dishesPath = arg('dishes');
if (dishesPath) {
  const refMapPath = arg('ref-map');
  if (!refMapPath) {
    console.error('--dishes requires --ref-map <ref-to-ifct-id.json>');
    process.exit(1);
  }
  const dishes = JSON.parse(readFileSync(resolve(dishesPath), 'utf8'));
  const refMap = JSON.parse(readFileSync(resolve(refMapPath), 'utf8'));
  const known = new Set(rows.map((r) => r.id));
  const missing = validateDishRefs(dishes, refMap, known);
  if (missing.length > 0) {
    console.error(`✗ ${missing.length} dish ingredient refs unmapped:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`✓ all dish ingredient refs map to imported IFCT ids`);
}
