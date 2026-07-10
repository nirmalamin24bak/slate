#!/usr/bin/env node
// IFCT 2017 → supabase/seed/01_ingredients.sql (spec/06 layer 1).
//
//   node scripts/ifct-import.mjs --input path/to/ifct2017.csv
//     [--mapping scripts/ifct/mapping.json]   header overrides, see DEFAULT_MAPPING
//     [--out supabase/seed/01_ingredients.sql]
//     [--dishes supabase/seed/dishes.draft.json --ref-map scripts/ifct/ref-map.json]
//
// BLOCKED until the IFCT 2017 source file arrives from Nirmal (CSV export).
// With --dishes, also verifies every dish ingredient ref maps to an imported id.

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
