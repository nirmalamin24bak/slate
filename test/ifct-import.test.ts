import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_MAPPING,
  parseCsv,
  toIngredientRows,
  toSql,
  validateDishRefs,
} from '../scripts/ifct/parse.mjs';

// The IFCT 2017 import (spec/06 layer 1). The parser is pure and tested here
// against a fixture; the real run waits on the source file from Nirmal.

const fixture = readFileSync(resolve(__dirname, 'fixtures', 'ifct-sample.csv'), 'utf8');

describe('parseCsv', () => {
  test('parses headers and quoted fields containing commas', () => {
    const rows = parseCsv(fixture);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ code: 'A001', name: 'Bajra, whole' });
  });

  test('handles CRLF and trailing newline', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('toIngredientRows', () => {
  test('maps IFCT columns to the ingredients schema with prefixed ids', () => {
    const rows = toIngredientRows(parseCsv(fixture), DEFAULT_MAPPING);
    expect(rows[0]).toEqual({
      id: 'IFCT_A001',
      name: 'Bajra, whole',
      name_hi: 'बाजरा',
      kcal_100g: 347.9,
      protein_100g: 10.96,
      carbs_100g: 61.78,
      fat_100g: 5.43,
      fiber_100g: 11.49,
      sugar_100g: 1.36,
    });
    expect(rows).toHaveLength(3);
  });

  test('rejects a row with a non-numeric or absurd kcal instead of importing garbage', () => {
    const bad = parseCsv(
      'code,name,name_hi,enerc_kcal,protcnt_g,choavldf_g,fatce_g,fibtg_g,fsugar_g\nX1,Thing,,not-a-number,1,1,1,1,1\n',
    );
    expect(() => toIngredientRows(bad, DEFAULT_MAPPING)).toThrow(/kcal/i);
    const absurd = parseCsv(
      'code,name,name_hi,enerc_kcal,protcnt_g,choavldf_g,fatce_g,fibtg_g,fsugar_g\nX1,Thing,,1500,1,1,1,1,1\n',
    );
    expect(() => toIngredientRows(absurd, DEFAULT_MAPPING)).toThrow(/kcal/i);
  });

  test('rejects a missing id or name', () => {
    const noId = parseCsv(
      'code,name,name_hi,enerc_kcal,protcnt_g,choavldf_g,fatce_g,fibtg_g,fsugar_g\n,Thing,,100,1,1,1,1,1\n',
    );
    expect(() => toIngredientRows(noId, DEFAULT_MAPPING)).toThrow(/code|id/i);
  });

  test('empty fiber/sugar become null, not zero — absence is not a measurement', () => {
    const sparse = parseCsv(
      'code,name,name_hi,enerc_kcal,protcnt_g,choavldf_g,fatce_g,fibtg_g,fsugar_g\nY1,Ghee,,900,0,0,100,,\n',
    );
    const rows = toIngredientRows(sparse, DEFAULT_MAPPING);
    expect(rows[0]?.fiber_100g).toBeNull();
    expect(rows[0]?.sugar_100g).toBeNull();
  });
});

describe('toSql', () => {
  test('emits idempotent inserts with escaped quotes', () => {
    const sql: string = toSql([
      {
        id: 'IFCT_T090',
        name: "Farmer's cheese",
        name_hi: null,
        kcal_100g: 265,
        protein_100g: 18.3,
        carbs_100g: 1.2,
        fat_100g: 20.8,
        fiber_100g: null,
        sugar_100g: null,
      },
    ]);
    expect(sql).toContain("'Farmer''s cheese'");
    expect(sql).toContain('on conflict (id) do update');
    expect(sql).toContain('IFCT_T090');
    expect(sql).toContain('null');
  });
});

describe('validateDishRefs', () => {
  test('reports refs that no mapping entry or ingredient id covers', () => {
    const dishes = [
      { id: 'dish_poha', ingredients: [{ ref: 'rice_flattened', grams: 60 }] },
      { id: 'dish_x', ingredients: [{ ref: 'unicorn_meat', grams: 10 }] },
    ];
    const refMap = { rice_flattened: 'IFCT_A002' };
    const known = new Set(['IFCT_A002']);
    const missing: string[] = validateDishRefs(dishes, refMap, known);
    expect(missing).toEqual(['unicorn_meat']);
  });

  test('a mapped ref pointing at an unknown ingredient id is also missing', () => {
    const dishes = [{ id: 'dish_poha', ingredients: [{ ref: 'rice_flattened', grams: 60 }] }];
    const missing: string[] = validateDishRefs(dishes, { rice_flattened: 'IFCT_NOPE' }, new Set());
    expect(missing).toEqual(['rice_flattened']);
  });
});
