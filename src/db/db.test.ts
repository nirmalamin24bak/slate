import { describe, expect, it } from 'vitest';

import { sqliteCacheStore } from './cacheStore';
import {
  getEntry,
  insertEntry,
  listDay,
  listDirtyEntries,
  listRecents,
  listRetryable,
  listSavedFoods,
  markEntriesSynced,
  nextPosition,
  patchEntry,
} from './entriesRepo';
import {
  ensureUserRows,
  flushOnboarding,
  getKitchen,
  getProfile,
  listDirtyWeights,
  patchProfile,
  upsertWeight,
} from './profileRepo';
import {
  getExercise,
  loadCatalogue,
  loadDish,
  replaceDishes,
  replaceExercises,
  replaceIngredients,
  replacePackagedFoods,
} from './referenceRepo';
import type { SqlValue } from './adapter';
import { migrate, SCHEMA_VERSION } from './schema';
import { pullReference, pushDirty, type RemoteDb } from './sync';
import type { EntryRow, WeightRow } from './rows';
import { toKitchen } from './rows';

import { openTestDb } from '../../test/helpers/betterSqliteAdapter';

const USER = 'user-a';
const T0 = '2026-07-10T09:00:00.000Z';
const T1 = '2026-07-10T09:05:00.000Z';

function entry(overrides: Partial<EntryRow>): EntryRow {
  return {
    id: overrides.id ?? 'e1',
    user_id: USER,
    log_date: '2026-07-10',
    position: 0,
    raw_text: '2 roti',
    nickname: null,
    intent: 'food',
    status: 'resolving',
    resolved_ref: null,
    qty: null,
    unit: null,
    context: null,
    kcal: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    sugar_g: null,
    water_ml: null,
    step_count: null,
    sleep_minutes: null,
    is_included: 0,
    calc_version: 'engine-v1',
    was_calibrated: 0,
    created_at: T0,
    updated_at: T0,
    deleted_at: null,
    retryable: 0,
    dirty: 1,
    ...overrides,
  };
}

describe('schema', () => {
  it('migrates to the current version and is idempotent', async () => {
    const db = await openTestDb();
    const v = await db.get<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(SCHEMA_VERSION);
    await migrate(db); // second run: no-op, no throw
    db.close();
  });
});

describe('entriesRepo', () => {
  it('inserts, lists by day in position order, and skips soft-deleted rows', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'e1', position: 0 }));
    await insertEntry(db, entry({ id: 'e2', position: 1, raw_text: 'chai' }));
    await insertEntry(db, entry({ id: 'e3', position: 2, deleted_at: T1 }));

    const day = await listDay(db, USER, '2026-07-10');
    expect(day.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(await nextPosition(db, USER, '2026-07-10')).toBe(3);
    expect(await nextPosition(db, USER, '2026-07-11')).toBe(0);
    db.close();
  });

  it('patches resolution fields and marks the row dirty', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'e1' }));
    await markEntriesSynced(db, ['e1']);
    await patchEntry(db, 'e1', { status: 'resolved', kcal: 220, resolved_ref: 'dish_roti' }, T1);

    const row = await getEntry(db, 'e1');
    expect(row?.status).toBe('resolved');
    expect(row?.kcal).toBe(220);
    expect(row?.updated_at).toBe(T1);
    expect(row?.dirty).toBe(1);

    await patchEntry(db, 'e1', {}, T1); // empty patch: no-op
    db.close();
  });

  it('lists retryable unresolved lines oldest first', async () => {
    const db = await openTestDb();
    await insertEntry(
      db,
      entry({ id: 'old', status: 'unresolved', retryable: 1, created_at: T0, position: 0 }),
    );
    await insertEntry(
      db,
      entry({ id: 'new', status: 'unresolved', retryable: 1, created_at: T1, position: 1 }),
    );
    await insertEntry(db, entry({ id: 'done', status: 'resolved', position: 2 }));

    const queue = await listRetryable(db, USER);
    expect(queue.map((e) => e.id)).toEqual(['old', 'new']);
    db.close();
  });

  it('saved foods = nicknamed entries, latest per nickname; recents are distinct resolved foods', async () => {
    const db = await openTestDb();
    await insertEntry(
      db,
      entry({ id: 'a', nickname: 'my dal', status: 'resolved', created_at: T0, updated_at: T0 }),
    );
    await insertEntry(
      db,
      entry({
        id: 'b',
        nickname: 'my dal',
        status: 'resolved',
        raw_text: '1 katori dal',
        created_at: T1,
        updated_at: T1,
        position: 1,
      }),
    );
    await insertEntry(
      db,
      entry({ id: 'c', status: 'resolved', raw_text: 'chai', created_at: T1, position: 2 }),
    );

    const saved = await listSavedFoods(db, USER);
    expect(saved.map((e) => e.id)).toEqual(['b']);

    const recents = await listRecents(db, USER, 10);
    expect(recents).toContain('chai');
    expect(recents).toContain('1 katori dal');
    db.close();
  });
});

describe('weights', () => {
  const weight = (overrides: Partial<WeightRow>): WeightRow => ({
    id: 'w1',
    user_id: USER,
    log_date: '2026-07-10',
    weight_kg: 85,
    source: 'journal',
    created_at: T0,
    updated_at: T0,
    deleted_at: null,
    dirty: 1,
    ...overrides,
  });

  it('last write wins per (user, day)', async () => {
    const db = await openTestDb();
    await upsertWeight(db, weight({}));
    await upsertWeight(db, weight({ id: 'w2', weight_kg: 84.5, updated_at: T1 }));

    const rows = await db.all<WeightRow>('SELECT * FROM weights');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.weight_kg).toBe(84.5);
    db.close();
  });
});

describe('profiles + kitchen', () => {
  it('ensureUserRows is idempotent and applies schema defaults', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await ensureUserRows(db, USER, T1);

    const profile = await getProfile(db, USER);
    expect(profile?.calorie_goal).toBeNull(); // never defaulted — non-negotiable
    expect(profile?.weight_is_assumed).toBe(1);
    expect(profile?.show_exercise).toBe(0); // off by default (MASTER)

    const kitchen = await getKitchen(db, USER);
    expect(kitchen && toKitchen(kitchen).katoriMl).toBe(200);
    db.close();
  });

  it('flushOnboarding writes profiles + kitchen in one transaction', async () => {
    const db = await openTestDb();
    await flushOnboarding(
      db,
      USER,
      { sex: 'male', height_cm: 175, weight_kg: 80, weight_is_assumed: 0, calorie_goal: 2200 },
      { katori_ml: 250, roti_g: 50, is_assumed: 0 },
      T0,
    );
    const profile = await getProfile(db, USER);
    const kitchen = await getKitchen(db, USER);
    expect(profile?.calorie_goal).toBe(2200);
    expect(kitchen?.katori_ml).toBe(250);
    db.close();
  });

  it('rolls the whole flush back when one write fails', async () => {
    const db = await openTestDb();
    await expect(
      flushOnboarding(
        db,
        USER,
        { sex: 'male' },
        // chai_milk has no column named this — forces a failure mid-transaction
        { ['nonexistent_column' as 'katori_ml']: 1 } as never,
        T0,
      ),
    ).rejects.toThrow();
    expect(await getProfile(db, USER)).toBeNull();
    db.close();
  });

  it('patchProfile with an empty patch is a no-op', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await patchProfile(db, USER, {}, T1);
    const profile = await getProfile(db, USER);
    expect(profile?.updated_at).toBe(T0);
    db.close();
  });
});

describe('cacheStore', () => {
  it('round-trips a resolution and bumps hit_count on rewrite', async () => {
    const db = await openTestDb();
    const store = sqliteCacheStore(db);
    expect(await store.get('2 roti')).toBeNull();

    await store.put('2 roti', {
      intent: 'food',
      ref: 'dish_roti',
      qty: 2,
      unit: 'roti',
      confidence: 0.95,
    });
    expect(await store.get('2 roti')).toEqual({
      intent: 'food',
      ref: 'dish_roti',
      qty: 2,
      unit: 'roti',
      confidence: 0.95,
    });

    await store.put('2 roti', {
      intent: 'food',
      ref: 'dish_roti',
      qty: 2,
      unit: 'roti',
      confidence: 0.97,
    });
    const row = await db.get<{ hit_count: number }>(
      'SELECT hit_count FROM resolution_cache WHERE normalized_text = ?',
      ['2 roti'],
    );
    expect(row?.hit_count).toBe(2);
    db.close();
  });
});

const REFERENCE_FIXTURE = {
  ingredients: [
    {
      id: 'IFCT_A001',
      name: 'Wheat flour',
      kcal_100g: 320,
      protein_100g: 12,
      carbs_100g: 64,
      fat_100g: 2,
      fiber_100g: 11,
      sugar_100g: 2,
    },
  ],
  dishes: [
    {
      id: 'dish_roti',
      name: 'Roti',
      default_unit: 'roti',
      default_qty: 1,
      is_home_cookable: 1,
      cooking_fat_ml: 0,
    },
  ],
  dish_ingredients: [{ dish_id: 'dish_roti', ingredient_id: 'IFCT_A001', grams: 35 }],
  exercises: [{ id: 'ex_jog', name: 'Jogging', met: 7, unit: 'minutes', is_ambulatory: 1 }],
  packaged_foods: [
    {
      barcode: '890123',
      brand: null,
      name: 'Biscuit',
      kcal_100g: 480,
      protein_100g: 6,
      carbs_100g: 70,
      fat_100g: 18,
      fiber_100g: 2,
      sugar_100g: 24,
    },
  ],
};

describe('referenceRepo', () => {
  it('replaces mirrors and serves the catalogue + joined dish', async () => {
    const db = await openTestDb();
    await replaceIngredients(db, REFERENCE_FIXTURE.ingredients);
    await replaceDishes(db, REFERENCE_FIXTURE.dishes, REFERENCE_FIXTURE.dish_ingredients);
    await replaceExercises(db, REFERENCE_FIXTURE.exercises);
    await replacePackagedFoods(db, REFERENCE_FIXTURE.packaged_foods);

    const catalogue = await loadCatalogue(db);
    expect(catalogue.dishes.has('dish_roti')).toBe(true);
    expect(catalogue.exercises.has('ex_jog')).toBe(true);
    expect(catalogue.packagedFoods.has('890123')).toBe(true);
    expect(catalogue.customDishes.size).toBe(0);

    const dish = await loadDish(db, 'dish_roti');
    expect(dish?.isHomeCookable).toBe(true);
    expect(dish?.ingredients[0]?.grams).toBe(35);
    expect(await loadDish(db, 'dish_missing')).toBeNull();

    const jog = await getExercise(db, 'ex_jog');
    expect(jog?.met).toBe(7);
    db.close();
  });
});

describe('sync', () => {
  function fakeRemote(): RemoteDb & {
    upserts: Record<string, Record<string, unknown>[]>;
  } {
    const upserts: Record<string, Record<string, unknown>[]> = {};
    return {
      upserts,
      async upsert(table, rows) {
        upserts[table] = [...(upserts[table] ?? []), ...rows];
      },
      async fetchAll(table) {
        const fixture = REFERENCE_FIXTURE as unknown as Record<string, Record<string, SqlValue>[]>;
        return fixture[table] ?? [];
      },
    };
  }

  it('pushes dirty rows without local-only columns, then marks them clean', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await insertEntry(db, entry({ id: 'e1', retryable: 1 }));
    await upsertWeight(db, {
      id: 'w1',
      user_id: USER,
      log_date: '2026-07-10',
      weight_kg: 85,
      source: 'journal',
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
      dirty: 1,
    });

    const remote = fakeRemote();
    await pushDirty(db, remote);

    const pushedEntry = remote.upserts['entries']?.[0];
    expect(pushedEntry).toBeDefined();
    expect(pushedEntry).not.toHaveProperty('dirty');
    expect(pushedEntry).not.toHaveProperty('retryable');
    expect(remote.upserts['weights']).toHaveLength(1);
    expect(remote.upserts['profiles']).toHaveLength(1);
    expect(remote.upserts['kitchen']).toHaveLength(1);

    expect(await listDirtyEntries(db)).toHaveLength(0);
    expect(await listDirtyWeights(db)).toHaveLength(0);

    // second push: nothing dirty, nothing sent
    const remote2 = fakeRemote();
    await pushDirty(db, remote2);
    expect(remote2.upserts['entries']).toBeUndefined();
    expect(remote2.upserts['profiles']).toBeUndefined();
    db.close();
  });

  it('pullReference replaces every mirror', async () => {
    const db = await openTestDb();
    await pullReference(db, fakeRemote());
    const catalogue = await loadCatalogue(db);
    expect(catalogue.dishes.size).toBe(1);
    expect(catalogue.exercises.size).toBe(1);
    expect(catalogue.packagedFoods.size).toBe(1);
    db.close();
  });
});
