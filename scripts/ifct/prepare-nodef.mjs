#!/usr/bin/env node
// nodef @ifct2017/compositions CSV → import-ready IFCT CSV (spec/06 layer 1).
//
//   node scripts/ifct/prepare-nodef.mjs
//     [--input scripts/ifct/data/nodef-compositions-2.0.9.csv]
//     [--out scripts/ifct/data/ifct2017.csv]
//
// Source: npm @ifct2017/compositions@2.0.9 (MIT — LICENSE-nodef.txt alongside;
// the GitHub repo relicensed to AGPL in 2025, but the published npm artifact
// carries its own MIT grant, which is what we vendored). The underlying values
// are the Indian Food Composition Tables 2017, NIN Hyderabad — 542 foods.
//
// Three things the raw file needs before ifct-import.mjs can eat it:
//   1. Headers are "Label; code" (e.g. "Energy; enerc") → rename to the plain
//      codes DEFAULT_MAPPING expects.
//   2. Energy is kJ → convert to kcal (÷ 4.184).
//   3. Pure oils/ghee (T group) carry enerc = 0 in the source — the book leaves
//      energy blank for 100%-fat foods. Without a fallback they'd import as
//      0-kcal oils and silently deflate every fried dish. Derive by Atwater.
//
// Data-quality gate: every row is cross-checked against its own macros
// (Atwater: 4·protein + 4·carbs + 9·fat + 2·fiber). A row whose stated energy
// deviates >12% from the macro-derived value is a digitization error in the
// source and is listed loudly (known: N001 chicken leg, 384 kcal stated vs
// ~191 by macros). Flagged rows still import — the flag tells you not to map
// a dish ref to them.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv } from './parse.mjs';

const KJ_PER_KCAL = 4.184;
const DEVIATION_LIMIT = 0.12;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const input = resolve(arg('input', 'scripts/ifct/data/nodef-compositions-2.0.9.csv'));
const out = resolve(arg('out', 'scripts/ifct/data/ifct2017.csv'));

const records = parseCsv(readFileSync(input, 'utf8'));
if (records.length === 0) {
  console.error('no records parsed — wrong input file?');
  process.exit(1);
}

// Headers look like "Energy; enerc" — resolve each needed code to its column.
const headers = Object.keys(records[0]);
function col(code) {
  const hit = headers.find((h) => h.endsWith(`; ${code}`) || h === code);
  if (!hit) {
    console.error(`column with code "${code}" not found in ${input}`);
    process.exit(1);
  }
  return hit;
}

const C = {
  code: col('code'),
  name: col('name'),
  enerc: col('enerc'),
  protcnt: col('protcnt'),
  choavldf: col('choavldf'),
  fatce: col('fatce'),
  fibtg: col('fibtg'),
  fsugar: col('fsugar'),
};

const num = (v) => {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

const flagged = [];
const derived = [];
const lines = ['code,name,enerc_kcal,protcnt_g,choavldf_g,fatce_g,fibtg_g,fsugar_g'];

for (const rec of records) {
  const code = (rec[C.code] ?? '').trim();
  const name = (rec[C.name] ?? '').trim();
  if (!code || !name) continue;

  const protein = num(rec[C.protcnt]);
  const carbs = num(rec[C.choavldf]);
  const fat = num(rec[C.fatce]);
  const fiber = num(rec[C.fibtg]);
  const sugar = num(rec[C.fsugar]);
  // Fiber's energy factor varies by food (insoluble ≈ 0, fermentable ≈ 2), so
  // the defensible check is a band: macros alone at the floor, macros + 2·fiber
  // at the ceiling. Stated energy inside the band is consistent; outside it by
  // >12% is a digitization error (e.g. N001 chicken leg, zero fiber, stated 2×
  // its macros).
  const atwaterLow = 4 * protein + 4 * carbs + 9 * fat;
  const atwaterHigh = atwaterLow + 2 * fiber;

  let kcal = num(rec[C.enerc]) / KJ_PER_KCAL;
  if (kcal === 0 && atwaterHigh > 0) {
    // The book leaves energy blank for pure fats (T group) — derive it.
    kcal = atwaterLow;
    derived.push(`${code} ${name} → ${Math.round(kcal)} kcal (Atwater)`);
  } else if (
    atwaterLow > 50 &&
    (kcal < atwaterLow * (1 - DEVIATION_LIMIT) || kcal > atwaterHigh * (1 + DEVIATION_LIMIT))
  ) {
    flagged.push(
      `${code} ${name}: stated ${Math.round(kcal)} kcal vs macro band ${Math.round(atwaterLow)}-${Math.round(atwaterHigh)} — do not map dish refs to this row`,
    );
  }

  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  lines.push([code, esc(name), kcal.toFixed(1), protein, carbs, fat, fiber, sugar].join(','));
}

writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(`wrote ${out} (${lines.length - 1} foods)`);
if (derived.length > 0) {
  console.log(`\nenergy derived by Atwater (source blank):`);
  for (const d of derived) console.log(`  ${d}`);
}
if (flagged.length > 0) {
  console.log(`\n⚠ energy/macro mismatches in the source (imported, but do not use):`);
  for (const f of flagged) console.log(`  ${f}`);
}
