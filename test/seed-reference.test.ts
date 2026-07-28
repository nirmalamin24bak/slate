// The dish/exercise seed generator (scripts/seed/reference.mjs). Reference data
// is the one class of row a user cannot correct: if a recipe is wrong in the
// seed, every journal line that touches it is wrong and nobody can tell. So the
// generator refuses malformed input rather than emitting SQL that applies
// cleanly and means something wrong.

import { describe, expect, it } from 'vitest';

// Plain JS module — the script layer is deliberately untyped; allowJs resolves it.
import {
  dishesToSql,
  exercisesToSql,
  ingredientIdsFromSql,
  validateDishes,
  validateExercises,
} from '../scripts/seed/reference.mjs';

const REF_MAP: Record<string, string> = { rice: 'IFCT_A015', dal: 'IFCT_B021' };
const KNOWN = new Set(['IFCT_A015', 'IFCT_B021']);

function dish(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dish_test',
    name: 'Test Dish',
    region: null,
    aliases: ['test'],
    default_unit: 'katori',
    default_qty: 1,
    is_home_cookable: true,
    cooking_fat_ml: 5,
    serving_g: 200,
    ingredients: [{ ref: 'rice', grams: 50 }],
    ...overrides,
  };
}

function exercise(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ex_test',
    name: 'Test',
    aliases: ['test'],
    met: 4,
    unit: 'minutes',
    is_ambulatory: false,
    ...overrides,
  };
}

describe('validateDishes', () => {
  it('accepts a well-formed dish', () => {
    expect(validateDishes([dish()], REF_MAP, KNOWN)).toEqual([]);
  });

  it('rejects an ingredient ref that is not in the map, or maps to nothing imported', () => {
    const unmapped = validateDishes(
      [dish({ ingredients: [{ ref: 'mystery', grams: 10 }] })],
      REF_MAP,
      KNOWN,
    );
    expect(unmapped.join()).toContain('not in the ref map');

    const dangling = validateDishes([dish()], { rice: 'IFCT_NOPE' }, KNOWN);
    expect(dangling.join()).toContain('not an imported ingredient');
  });

  it('rejects the same ingredient listed twice — the PK would silently collapse them', () => {
    const errors = validateDishes(
      [
        dish({
          ingredients: [
            { ref: 'rice', grams: 30 },
            { ref: 'rice', grams: 20 },
          ],
        }),
      ],
      REF_MAP,
      KNOWN,
    );
    expect(errors.join()).toContain('listed twice');
  });

  it('rejects two dishes claiming the same alias — the resolver could not choose', () => {
    const errors = validateDishes(
      [dish(), dish({ id: 'dish_other', aliases: ['TEST'] })],
      REF_MAP,
      KNOWN,
    );
    expect(errors.join()).toContain('claimed by both');
  });

  it('rejects a duplicate dish id', () => {
    expect(validateDishes([dish(), dish()], REF_MAP, KNOWN).join()).toContain('duplicate dish id');
  });

  it('rejects a recipe with no ingredients — no lineage', () => {
    expect(validateDishes([dish({ ingredients: [] })], REF_MAP, KNOWN).join()).toContain(
      'no ingredients',
    );
  });

  it('rejects non-positive grams and default_qty', () => {
    expect(
      validateDishes([dish({ ingredients: [{ ref: 'rice', grams: 0 }] })], REF_MAP, KNOWN).join(),
    ).toContain('grams must be a positive number');
    expect(validateDishes([dish({ default_qty: 0 })], REF_MAP, KNOWN).join()).toContain(
      'default_qty must be a positive number',
    );
  });

  it('requires a volume-default dish to have decided serving_g', () => {
    const { serving_g: _omitted, ...withoutServing } = dish();
    expect(validateDishes([withoutServing], REF_MAP, KNOWN).join()).toContain('must declare');
    // an explicit null is a decision, not an omission
    expect(validateDishes([dish({ serving_g: null })], REF_MAP, KNOWN)).toEqual([]);
    expect(validateDishes([dish({ serving_g: -1 })], REF_MAP, KNOWN).join()).toContain('serving_g');
  });
});

describe('validateExercises', () => {
  it('accepts a well-formed exercise', () => {
    expect(validateExercises([exercise()])).toEqual([]);
  });

  it('rejects a MET outside the plausible band — a typo here becomes phantom calories', () => {
    expect(validateExercises([exercise({ met: 45 })]).join()).toContain('outside the plausible');
    expect(validateExercises([exercise({ met: 0.2 })]).join()).toContain('outside the plausible');
  });

  it('rejects a unit the engine cannot convert', () => {
    expect(validateExercises([exercise({ unit: 'reps' })]).join()).toContain('minutes');
  });

  it('rejects a missing is_ambulatory — it drives the steps double-count rule', () => {
    expect(validateExercises([exercise({ is_ambulatory: undefined })]).join()).toContain(
      'is_ambulatory',
    );
  });
});

describe('dishesToSql', () => {
  const sql: string = dishesToSql([dish()], REF_MAP);

  it('is idempotent — upserts rather than duplicating', () => {
    expect(sql).toContain('on conflict (id) do update set');
    expect(sql).toContain('on conflict (dish_id, ingredient_id) do update set grams');
  });

  it('runs in one transaction, so a half-applied recipe cannot survive', () => {
    expect(sql.startsWith('-- generated')).toBe(true);
    expect(sql).toContain('begin;');
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
  });

  it('deletes ingredients a corrected recipe no longer contains', () => {
    expect(sql).toContain('delete from dish_ingredients');
    expect(sql).toContain("('dish_test', 'IFCT_A015')");
  });

  it('writes aliases as a text[] and carries serving_g', () => {
    expect(sql).toContain("array['test']::text[]");
    expect(sql).toMatch(/true, 5, 200\)/);
  });

  it('escapes quotes in names rather than breaking out of the literal', () => {
    const out: string = dishesToSql([dish({ name: "Mummy's dal" })], REF_MAP);
    expect(out).toContain("'Mummy''s dal'");
  });

  it('emits an empty alias array rather than null', () => {
    expect(dishesToSql([dish({ aliases: [] })], REF_MAP)).toContain(`'{}'::text[]`);
  });
});

describe('exercisesToSql', () => {
  it('upserts every column but the id', () => {
    const sql: string = exercisesToSql([exercise()]);
    expect(sql).toContain('on conflict (id) do update set');
    expect(sql).toContain('met = excluded.met');
    expect(sql).toContain("'ex_test', 'Test'");
    expect(sql).toContain("4, 'minutes', false"); // met, unit, is_ambulatory in order
  });

  it('keeps is_ambulatory as a real boolean — the steps rule reads it', () => {
    expect(exercisesToSql([exercise({ is_ambulatory: true })])).toContain("'minutes', true");
  });
});

describe('ingredientIdsFromSql', () => {
  it('reads the ids back out of a generated ingredients seed', () => {
    const seed = [
      '-- generated',
      'insert into ingredients (id, name) values',
      "  ('IFCT_A015', 'Rice, raw, milled', null, 356.4, 7.94, 78.24, 0.52, 2.81, 0.69),",
      "  ('SUPP_SUGAR', 'Sugar', null, 398, 0, 99.5, 0, null, 99.5)",
      'on conflict (id) do update set name = excluded.name;',
    ].join('\n');
    expect([...ingredientIdsFromSql(seed)]).toEqual(['IFCT_A015', 'SUPP_SUGAR']);
  });

  it('returns an empty set for a file with no rows, so the caller can fail loudly', () => {
    expect(ingredientIdsFromSql('-- nothing here').size).toBe(0);
  });
});
