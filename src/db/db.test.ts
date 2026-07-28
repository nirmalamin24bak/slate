import { describe, expect, it } from 'vitest';

import { MAX_LOCAL_CACHE_ROWS, sqliteCacheStore } from './cacheStore';
import {
  getEntry,
  insertEntry,
  listAllEntries,
  listDay,
  listDayStats,
  listDaySummaries,
  listDirtyEntries,
  listLoggedDates,
  listRecents,
  listResolving,
  listRetryable,
  listSavedFoods,
  markEntriesSynced,
  nextPosition,
  patchEntry,
  pullMergeEntries,
} from './entriesRepo';
import {
  ensureUserRows,
  flushOnboarding,
  getKitchen,
  getProfile,
  listDirtyWeights,
  listWeights,
  markWeightsSynced,
  patchKitchen,
  patchProfile,
  pullMergeKitchen,
  pullMergeProfile,
  pullMergeWeights,
  upsertWeight,
} from './profileRepo';
import {
  getExercise,
  getPackagedFood,
  loadCatalogue,
  loadDish,
  replaceDishes,
  replaceExercises,
  replaceIngredients,
  replacePackagedFoods,
  upsertPackagedFoodLocal,
} from './referenceRepo';
import type { SqlAdapter, SqlValue } from './adapter';
import { adoptPendingUser, PENDING_USER_ID } from './adoption';
import { migrate, SCHEMA_VERSION } from './schema';
import {
  collectKeyset,
  cursorOf,
  pullReference,
  pullUserData,
  pushDirty,
  type RemoteDb,
  type SyncCursor,
} from './sync';
import type { EntryRow, KitchenRow, WeightRow } from './rows';
import { toKitchen } from './rows';

import { openTestDb } from '../../test/helpers/betterSqliteAdapter';

const USER = 'user-a';
const T0 = '2026-07-10T09:00:00.000Z';
const T1 = '2026-07-10T09:05:00.000Z';
const T2 = '2026-07-10T09:10:00.000Z';

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
    await markEntriesSynced(db, [{ id: 'e1', updated_at: T0 }]);
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

  it('lists resolving lines (crash-stuck) oldest first, ignoring resolved/deleted', async () => {
    const db = await openTestDb();
    await insertEntry(
      db,
      entry({ id: 'stuck-old', status: 'resolving', created_at: T0, position: 0 }),
    );
    await insertEntry(
      db,
      entry({ id: 'stuck-new', status: 'resolving', created_at: T1, position: 1 }),
    );
    await insertEntry(db, entry({ id: 'done', status: 'resolved', position: 2 }));
    await insertEntry(db, entry({ id: 'gone', status: 'resolving', deleted_at: T1, position: 3 }));

    const stuck = await listResolving(db, USER);
    expect(stuck.map((e) => e.id)).toEqual(['stuck-old', 'stuck-new']);
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

// The read surfaces feeding streak (§E0), Stats (§E), History, and the export
// bundle (spec/08). Pure aggregation is tested in stats/aggregate.test.ts and
// journal/streak.test.ts; here we prove the SQL feeds them the right shapes.
describe('entriesRepo — read surfaces', () => {
  it('listLoggedDates: distinct non-deleted day keys, any intent, newest first', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'a', log_date: '2026-07-08', intent: 'food' }));
    await insertEntry(db, entry({ id: 'b', log_date: '2026-07-08', intent: 'water', position: 1 }));
    await insertEntry(db, entry({ id: 'c', log_date: '2026-07-10', intent: 'steps', position: 2 }));
    await insertEntry(db, entry({ id: 'd', log_date: '2026-07-09', deleted_at: T1, position: 3 }));

    // one chai is a logged day; two entries on the 8th collapse to one day; the
    // soft-deleted 9th does not appear at all.
    expect(await listLoggedDates(db, USER)).toEqual(['2026-07-10', '2026-07-08']);
    db.close();
  });

  it('listDayStats: sums food into consumed/macros, counted burns into burned, in range', async () => {
    const db = await openTestDb();
    await insertEntry(
      db,
      entry({
        id: 'f',
        log_date: '2026-07-10',
        intent: 'food',
        status: 'resolved',
        kcal: 500,
        protein_g: 20,
        carbs_g: 60,
        fat_g: 15,
        fiber_g: 8,
        sugar_g: 5,
      }),
    );
    await insertEntry(
      db,
      entry({
        id: 's',
        log_date: '2026-07-10',
        intent: 'steps',
        status: 'resolved',
        kcal: -120, // stored negative; is_included = 0 so it counts
        is_included: 0,
        position: 1,
      }),
    );
    await insertEntry(
      db,
      entry({
        id: 'x',
        log_date: '2026-07-10',
        intent: 'exercise',
        status: 'resolved',
        kcal: -200,
        is_included: 1, // counted elsewhere → excluded from burned
        position: 2,
      }),
    );
    await insertEntry(
      db,
      entry({ id: 'w', log_date: '2026-07-10', intent: 'water', water_ml: 500, position: 3 }),
    );
    // out of range — must be excluded
    await insertEntry(
      db,
      entry({ id: 'old', log_date: '2026-07-01', intent: 'food', status: 'resolved', kcal: 999 }),
    );

    const stats = await listDayStats(db, USER, '2026-07-05', '2026-07-10');
    expect(stats).toHaveLength(1);
    const day = stats[0];
    expect(day?.log_date).toBe('2026-07-10');
    expect(day?.consumed_kcal).toBe(500);
    expect(day?.burned_kcal).toBe(120); // positive magnitude; included burn excluded
    expect(day?.protein_g).toBe(20);
    expect(day?.fiber_g).toBe(8);
    expect(day?.water_ml).toBe(500);
    db.close();
  });

  it('listDaySummaries: one row per day, entry count and net kcal, newest first, limited', async () => {
    const db = await openTestDb();
    await insertEntry(
      db,
      entry({ id: 'a', log_date: '2026-07-10', status: 'resolved', kcal: 300, is_included: 0 }),
    );
    await insertEntry(
      db,
      entry({
        id: 'b',
        log_date: '2026-07-10',
        intent: 'steps',
        status: 'resolved',
        kcal: -100,
        is_included: 0,
        position: 1,
      }),
    );
    await insertEntry(
      db,
      entry({ id: 'c', log_date: '2026-07-09', status: 'resolved', kcal: 250, position: 2 }),
    );

    const all = await listDaySummaries(db, USER, 10);
    expect(all.map((d) => d.log_date)).toEqual(['2026-07-10', '2026-07-09']);
    const latest = all[0];
    expect(latest?.entry_count).toBe(2);
    expect(latest?.net_kcal).toBe(200); // 300 food − 100 burn

    const limited = await listDaySummaries(db, USER, 1);
    expect(limited).toHaveLength(1);
    expect(limited[0]?.log_date).toBe('2026-07-10');
    db.close();
  });

  it('listAllEntries: every non-deleted entry, oldest first by day then position', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'later', log_date: '2026-07-10', position: 1 }));
    await insertEntry(db, entry({ id: 'earlier', log_date: '2026-07-10', position: 0 }));
    await insertEntry(db, entry({ id: 'oldday', log_date: '2026-07-08', position: 0 }));
    await insertEntry(
      db,
      entry({ id: 'gone', log_date: '2026-07-09', deleted_at: T1, position: 0 }),
    );

    const rows = await listAllEntries(db, USER);
    expect(rows.map((e) => e.id)).toEqual(['oldday', 'earlier', 'later']);
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

  it('listWeights: non-deleted, oldest first — Stats line + export', async () => {
    const db = await openTestDb();
    await upsertWeight(db, weight({ id: 'w1', log_date: '2026-07-10', weight_kg: 82 }));
    await upsertWeight(db, weight({ id: 'w2', log_date: '2026-07-05', weight_kg: 84 }));
    await upsertWeight(
      db,
      weight({ id: 'w3', log_date: '2026-07-08', weight_kg: 83, deleted_at: T1 }),
    );

    const rows = await listWeights(db, USER);
    expect(rows.map((w) => w.log_date)).toEqual(['2026-07-05', '2026-07-10']);
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
    // write, read, write — a read counts too, because eviction sorts on usage
    // and a phrase that keeps being read is exactly what must not be dropped.
    expect(row?.hit_count).toBe(3);
    db.close();
  });

  it('a read marks the row used, so eviction can tell popular from stale', async () => {
    const db = await openTestDb();
    const store = sqliteCacheStore(db, { now: () => new Date('2026-07-10T09:00:00.000Z') });
    await store.put('chai', {
      intent: 'food',
      ref: 'dish_chai',
      qty: 1,
      unit: null,
      confidence: 1,
    });
    await store.get('chai');
    const row = await db.get<{ hit_count: number; last_hit_at: string | null }>(
      'SELECT hit_count, last_hit_at FROM resolution_cache WHERE normalized_text = ?',
      ['chai'],
    );
    expect(row?.hit_count).toBe(2);
    expect(row?.last_hit_at).toBe('2026-07-10T09:00:00.000Z');
    db.close();
  });

  it('the mirror is bounded, and evicts what is least used — not what is newest', async () => {
    const db = await openTestDb();
    let tick = 0;
    const store = sqliteCacheStore(db, {
      now: () => new Date(Date.parse('2026-07-10T09:00:00.000Z') + tick++ * 1000),
    });
    const write = (key: string) =>
      store.put(key, { intent: 'food', ref: 'dish_roti', qty: 1, unit: 'roti', confidence: 0.9 });

    // fill exactly to the bound
    for (let i = 0; i < MAX_LOCAL_CACHE_ROWS; i++) await write(`phrase ${i}`);
    expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM resolution_cache'))?.n).toBe(
      MAX_LOCAL_CACHE_ROWS,
    );

    // "2 roti" is read often; it must survive the next writes
    await write('2 roti');
    for (let i = 0; i < 5; i++) await store.get('2 roti');

    for (let i = 0; i < 10; i++) await write(`newcomer ${i}`);

    const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM resolution_cache'))?.n;
    expect(count).toBe(MAX_LOCAL_CACHE_ROWS); // never grows past the bound
    expect(await store.get('2 roti')).not.toBeNull(); // the used row stays
    // and the newest writes are still there — eviction is by usage, not age
    expect(await store.get('newcomer 9')).not.toBeNull();
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

  it('upsertPackagedFoodLocal caches an OFF hit but never clobbers our corrected row', async () => {
    const db = await openTestDb();
    // A fresh OFF scan lands in the mirror so the resolver can validate the ref.
    await upsertPackagedFoodLocal(db, { barcode: '111', name: 'OFF Snack', kcal_100g: 500 });
    const cat = await loadCatalogue(db);
    expect(cat.packagedFoods.has('111')).toBe(true); // resolver can now validate the ref
    expect((await getPackagedFood(db, '111'))?.name).toBe('OFF Snack');

    // Our authoritative row arrived first; INSERT OR IGNORE must keep it.
    await replacePackagedFoods(db, [
      {
        barcode: '222',
        brand: null,
        name: 'Ours',
        kcal_100g: 100,
        protein_100g: null,
        carbs_100g: null,
        fat_100g: null,
        fiber_100g: null,
        sugar_100g: null,
      },
    ]);
    await upsertPackagedFoodLocal(db, { barcode: '222', name: 'OFF Override', kcal_100g: 999 });
    const ours = await getPackagedFood(db, '222');
    expect(ours?.name).toBe('Ours'); // ours wins
    expect(ours?.kcal_100g).toBe(100);
    db.close();
  });
});

describe('sync', () => {
  const str = (r: Record<string, SqlValue>, c: string) =>
    typeof r[c] === 'string' ? (r[c] as string) : '';

  /** Total order (updated_at, keyColumn) — what the server is asked to return. */
  function totalOrder(rows: readonly Record<string, SqlValue>[], keyColumn: string) {
    return [...rows].sort((a, b) => {
      const byTime = str(a, 'updated_at').localeCompare(str(b, 'updated_at'));
      return byTime !== 0 ? byTime : str(a, keyColumn).localeCompare(str(b, keyColumn));
    });
  }

  /**
   * A remote that serves rows in total order and honours a keyset cursor, the
   * way PostgREST does with the filter services.ts builds.
   */
  function fakeRemote(owned: Record<string, Record<string, SqlValue>[]> = {}): RemoteDb & {
    upserts: Record<string, Record<string, unknown>[]>;
    fetchCalls: { table: string; since: string | null }[];
  } {
    const upserts: Record<string, Record<string, unknown>[]> = {};
    const fetchCalls: { table: string; since: string | null }[] = [];
    return {
      upserts,
      fetchCalls,
      async upsert(table, rows) {
        upserts[table] = [...(upserts[table] ?? []), ...rows];
      },
      async fetchAll(table) {
        const fixture = REFERENCE_FIXTURE as unknown as Record<string, Record<string, SqlValue>[]>;
        return fixture[table] ?? [];
      },
      async fetchOwned(table, _userId, cursor, keyColumn) {
        fetchCalls.push({ table, since: cursor?.updatedAt ?? null });
        return totalOrder(owned[table] ?? [], keyColumn).filter((r) => {
          if (!cursor) return true;
          const u = str(r, 'updated_at');
          return u > cursor.updatedAt || (u === cursor.updatedAt && str(r, keyColumn) > cursor.key);
        });
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

  it('adoptPendingUser re-homes every owned table from placeholder to the real uid', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, PENDING_USER_ID, T0);
    await insertEntry(db, entry({ id: 'e1', user_id: PENDING_USER_ID }));
    await upsertWeight(db, {
      id: 'w1',
      user_id: PENDING_USER_ID,
      log_date: '2026-07-10',
      weight_kg: 85,
      source: 'onboarding',
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
      dirty: 1,
    });

    await adoptPendingUser(db, 'real-uid');

    expect(await listDay(db, PENDING_USER_ID, '2026-07-10')).toHaveLength(0);
    expect((await listDay(db, 'real-uid', '2026-07-10')).map((e) => e.id)).toEqual(['e1']);
    expect(await getProfile(db, 'real-uid')).not.toBeNull();
    expect(await getProfile(db, PENDING_USER_ID)).toBeNull();
    // re-homed rows are dirty so they push under the real owner
    expect((await listDirtyEntries(db)).every((e) => e.user_id === 'real-uid')).toBe(true);
    db.close();
  });

  it("owner-scoped push never sends another user's (or placeholder) rows", async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await ensureUserRows(db, 'pending-anon', T0);
    await insertEntry(db, entry({ id: 'mine', user_id: USER }));
    await insertEntry(db, entry({ id: 'pending', user_id: 'pending-anon' }));

    const remote = fakeRemote();
    await pushDirty(db, remote, USER); // scoped to USER

    const pushedIds = (remote.upserts['entries'] ?? []).map((r) => r['id']);
    expect(pushedIds).toEqual(['mine']); // placeholder row withheld
    const pushedProfiles = (remote.upserts['profiles'] ?? []).map((r) => r['user_id']);
    expect(pushedProfiles).toEqual([USER]);
    // the withheld rows stay dirty for a later, correctly-scoped push
    expect((await listDirtyEntries(db)).map((e) => e.id)).toContain('pending');
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

  // A server entry row as fetchOwned returns it (no local-only columns).
  function serverEntry(over: Partial<EntryRow>): Record<string, SqlValue> {
    const { retryable: _r, dirty: _d, ...rest } = entry(over);
    return rest as unknown as Record<string, SqlValue>;
  }

  it('pullUserData inserts server rows absent locally', async () => {
    const db = await openTestDb();
    await pullUserData(
      db,
      fakeRemote({ entries: [serverEntry({ id: 'srv1', raw_text: '2 roti' })] }),
      USER,
    );
    const row = await getEntry(db, 'srv1');
    expect(row?.raw_text).toBe('2 roti');
    expect(row?.dirty).toBe(0); // pulled rows are clean
    db.close();
  });

  it('pullUserData takes a strictly-newer server row (last-write-wins)', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'e1', raw_text: 'old', updated_at: T0 }));
    await markEntriesSynced(db, [{ id: 'e1', updated_at: T0 }]); // clean
    await pullUserData(
      db,
      fakeRemote({ entries: [serverEntry({ id: 'e1', raw_text: 'new', updated_at: T1 })] }),
      USER,
    );
    expect((await getEntry(db, 'e1'))?.raw_text).toBe('new');
    db.close();
  });

  it('pullUserData ignores an older-or-equal server row', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'e1', raw_text: 'local', updated_at: T1 }));
    await markEntriesSynced(db, [{ id: 'e1', updated_at: T1 }]);
    await pullUserData(
      db,
      fakeRemote({ entries: [serverEntry({ id: 'e1', raw_text: 'stale', updated_at: T0 })] }),
      USER,
    );
    expect((await getEntry(db, 'e1'))?.raw_text).toBe('local');
    db.close();
  });

  it('pullUserData never clobbers a locally-dirty row, even with a newer server copy', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'e1', raw_text: 'my unsynced edit', updated_at: T1 }));
    // left dirty (insert defaults dirty=1)
    await pullUserData(
      db,
      fakeRemote({ entries: [serverEntry({ id: 'e1', raw_text: 'server', updated_at: T2 })] }),
      USER,
    );
    const row = await getEntry(db, 'e1');
    expect(row?.raw_text).toBe('my unsynced edit'); // dirty wins until it pushes
    expect(row?.dirty).toBe(1);
    db.close();
  });

  it('pullUserData applies a server tombstone (deleted_at) so the row leaves the day', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'e1', updated_at: T0 }));
    await markEntriesSynced(db, [{ id: 'e1', updated_at: T0 }]);
    await pullUserData(
      db,
      fakeRemote({ entries: [serverEntry({ id: 'e1', updated_at: T1, deleted_at: T1 })] }),
      USER,
    );
    expect(await listDay(db, USER, '2026-07-10')).toHaveLength(0);
    db.close();
  });

  it('delta sync: first pull is full, later pulls pass the watermark and take only newer rows', async () => {
    const db = await openTestDb();

    // First sync of a fresh device: no watermark → since is null → full pull.
    const r1 = fakeRemote({
      entries: [serverEntry({ id: 's1', raw_text: 'one', updated_at: T0 })],
    });
    await pullUserData(db, r1, USER);
    expect(r1.fetchCalls.find((c) => c.table === 'entries')?.since).toBeNull();
    expect((await getEntry(db, 's1'))?.raw_text).toBe('one');

    // Second sync: the watermark (max updated_at seen = T0) is passed as `since`,
    // and the mock returns only rows strictly newer — s1 (at T0) is not re-sent,
    // s2 (at T1) is.
    const r2 = fakeRemote({
      entries: [
        serverEntry({ id: 's1', raw_text: 'one', updated_at: T0 }),
        serverEntry({ id: 's2', raw_text: 'two', updated_at: T1 }),
      ],
    });
    await pullUserData(db, r2, USER);
    expect(r2.fetchCalls.find((c) => c.table === 'entries')?.since).toBe(T0);
    expect((await getEntry(db, 's2'))?.raw_text).toBe('two');

    // Third sync with nothing new: watermark is now T1, delta returns empty.
    const r3 = fakeRemote({
      entries: [
        serverEntry({ id: 's1', updated_at: T0 }),
        serverEntry({ id: 's2', updated_at: T1 }),
      ],
    });
    await pullUserData(db, r3, USER);
    expect(r3.fetchCalls.find((c) => c.table === 'entries')?.since).toBe(T1);
    db.close();
  });

  it('delta watermark is per-user: an adopted identity starts with a full pull', async () => {
    const db = await openTestDb();
    await pullUserData(
      db,
      fakeRemote({ entries: [serverEntry({ id: 's1', updated_at: T0 })] }),
      USER,
    );
    // A different user id has no watermark yet → full pull (since null).
    const other = fakeRemote({ entries: [serverEntry({ id: 's9', updated_at: T0 })] });
    await pullUserData(db, other, 'user-b');
    expect(other.fetchCalls.find((c) => c.table === 'entries')?.since).toBeNull();
    db.close();
  });

  it('push then re-push is idempotent (crash after upsert leaves the row dirty)', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await insertEntry(db, entry({ id: 'e1', updated_at: T0 }));
    // Simulate a crash after the network upsert but before markSynced: the row
    // is still dirty. The next push re-sends it — the server upsert is
    // idempotent, and nothing was lost.
    const remote1 = fakeRemote();
    await remote1.upsert('entries', [{ id: 'e1' }]); // "sent" but not marked
    expect((await getEntry(db, 'e1'))?.dirty).toBe(1);
    const remote2 = fakeRemote();
    await pushDirty(db, remote2, USER);
    expect(remote2.upserts['entries']).toHaveLength(1);
    expect(await listDirtyEntries(db)).toHaveLength(0); // now marked clean
    db.close();
  });

  it('an edit racing between push and mark keeps the row dirty (no lost edit)', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await insertEntry(db, entry({ id: 'e1', updated_at: T0 }));
    // Read the dirty snapshot as pushDirty would, at updated_at T0.
    const snapshot = await listDirtyEntries(db);
    // User edits the row before the mark — updated_at moves to T1, dirty=1.
    await patchEntry(db, 'e1', { raw_text: 'edited mid-push' }, T1);
    // The guarded mark uses the snapshot's T0, which no longer matches.
    await markEntriesSynced(
      db,
      snapshot.map((e) => ({ id: e.id, updated_at: e.updated_at })),
    );
    expect((await getEntry(db, 'e1'))?.dirty).toBe(1); // edit survives, re-pushes
    db.close();
  });

  it('weights converge on the natural key across devices', async () => {
    const db = await openTestDb();
    await upsertWeight(db, {
      id: 'device-a-uuid',
      user_id: USER,
      log_date: '2026-07-10',
      weight_kg: 80,
      source: 'journal',
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
      dirty: 0,
    });
    await markWeightsSynced(db, [{ id: 'device-a-uuid', updated_at: T0 }]); // clean
    // Device B's row for the same day: different id, newer timestamp.
    await pullUserData(
      db,
      fakeRemote({
        weights: [
          {
            id: 'device-b-uuid',
            user_id: USER,
            log_date: '2026-07-10',
            weight_kg: 81,
            source: 'journal',
            created_at: T1,
            updated_at: T1,
            deleted_at: null,
          },
        ],
      }),
      USER,
    );
    const weights = await listWeights(db, USER);
    expect(weights).toHaveLength(1); // one row per (user, day)
    expect(weights[0]?.weight_kg).toBe(81); // newer wins
    db.close();
  });

  it('an empty pull changes nothing', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'e1', raw_text: 'kept', updated_at: T0 }));
    await pullUserData(db, fakeRemote(), USER);
    expect((await getEntry(db, 'e1'))?.raw_text).toBe('kept');
    db.close();
  });
});

// The merge functions take server payloads as loose Record<string, SqlValue>,
// because what comes back over the wire is not typed by us. Every column read
// carries a `?? null` (or `?? 0`) fallback for exactly that reason. These tests
// drive the fallbacks: a payload that omits columns must insert cleanly rather
// than bind `undefined` (better-sqlite3 and expo-sqlite both throw on it), and
// must never fabricate a value for a column the server didn't send.
describe('down-sync merge — sparse payloads and guards', () => {
  // A pushed singleton is clean. There is no exported "mark profile synced"
  // (pushDirty clears it inline), so the tests below clear the flag directly —
  // the point under test is the merge guard, not how the flag got cleared.
  const markProfileClean = (db: SqlAdapter) =>
    db.run('UPDATE profiles SET dirty = 0 WHERE user_id = ?', [USER]);

  const SPARSE_ENTRY: Record<string, SqlValue> = {
    // only the NOT NULL columns; every nullable one is absent
    id: 'sparse-1',
    user_id: USER,
    log_date: '2026-07-11',
    position: 0,
    raw_text: 'paani',
    intent: 'water',
    status: 'resolved',
    calc_version: 'engine-v1',
    created_at: T0,
    updated_at: T0,
  };

  it('entries: a payload omitting every nullable column inserts with nulls, not undefined', async () => {
    const db = await openTestDb();
    await pullMergeEntries(db, [SPARSE_ENTRY]);
    const row = await getEntry(db, 'sparse-1');
    expect(row?.raw_text).toBe('paani');
    expect(row?.nickname).toBeNull();
    expect(row?.kcal).toBeNull();
    expect(row?.water_ml).toBeNull();
    expect(row?.deleted_at).toBeNull();
    // the two `?? 0` fallbacks: NOT NULL columns the payload didn't carry
    expect(row?.is_included).toBe(0);
    expect(row?.was_calibrated).toBe(0);
    // never dirty on arrival — it came FROM the server
    expect(row?.dirty).toBe(0);
    expect(row?.retryable).toBe(0);
    db.close();
  });

  it('weights: a payload omitting deleted_at merges on the natural key', async () => {
    const db = await openTestDb();
    await pullMergeWeights(db, [
      {
        id: 'w-sparse',
        user_id: USER,
        log_date: '2026-07-11',
        weight_kg: 79.5,
        source: 'journal',
        created_at: T0,
        updated_at: T0,
      },
    ]);
    const [row] = await listWeights(db, USER);
    expect(row?.weight_kg).toBe(79.5);
    expect(row?.deleted_at).toBeNull();
    expect(row?.dirty).toBe(0);
    db.close();
  });

  it('singletons: no row, or a row without updated_at / user_id, is a no-op', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await patchProfile(db, USER, { height_cm: 170 }, T0);
    await markProfileClean(db);

    await pullMergeProfile(db, undefined);
    await pullMergeProfile(db, { user_id: USER, height_cm: 199 }); // no updated_at
    await pullMergeProfile(db, { updated_at: T2, height_cm: 199 }); // no user_id
    await pullMergeKitchen(db, undefined);

    expect((await getProfile(db, USER))?.height_cm).toBe(170);
    db.close();
  });

  it('singletons: a payload carrying no data column touches no data column', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await patchProfile(db, USER, { height_cm: 170, calorie_goal: 1800 }, T0);
    await markProfileClean(db);

    // updated_at is itself a writable column, so the UPDATE still runs and the
    // local watermark advances — but nothing the user set may change.
    await pullMergeProfile(db, { user_id: USER, updated_at: T2 });
    const row = await getProfile(db, USER);
    expect(row?.height_cm).toBe(170);
    expect(row?.calorie_goal).toBe(1800);
    expect(row?.updated_at).toBe(T2);
    db.close();
  });

  it('singletons: writes only the columns the server sent, keeps the rest local', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await patchProfile(db, USER, { height_cm: 170, calorie_goal: 1800 }, T0);
    await markProfileClean(db);

    await pullMergeProfile(db, { user_id: USER, updated_at: T2, height_cm: 165 });
    const row = await getProfile(db, USER);
    expect(row?.height_cm).toBe(165); // sent → taken
    expect(row?.calorie_goal).toBe(1800); // omitted → local value survives
    db.close();
  });

  it('kitchen: a locally-dirty singleton is never overwritten by the server', async () => {
    const db = await openTestDb();
    await ensureUserRows(db, USER, T0);
    await patchKitchen(db, USER, { katori_ml: 250 }, T1); // dirty = 1
    await pullMergeKitchen(db, { user_id: USER, updated_at: T2, katori_ml: 150 });
    expect(toKitchen((await getKitchen(db, USER)) as KitchenRow).katoriMl).toBe(250);
    db.close();
  });
});

// Two devices, both offline, both reading the same nextPosition. There is no
// UNIQUE(user_id, log_date, position) — a naive one would break the resolver
// split's `position + N` bump — so after sync the day genuinely holds two rows
// at the same position. What must not happen is the two devices rendering that
// day in different orders: nothing is lost, but it reads as loss.
describe('entries ordering is total, not just by position', () => {
  it('two rows at the same position order identically every time', async () => {
    const db = await openTestDb();
    // deviceB's line was typed a minute later but landed on the same position
    await insertEntry(db, entry({ id: 'device-b', position: 1, raw_text: 'dal', created_at: T2 }));
    await insertEntry(db, entry({ id: 'device-a', position: 1, raw_text: 'roti', created_at: T1 }));
    await insertEntry(db, entry({ id: 'first', position: 0, raw_text: 'chai', created_at: T0 }));

    const texts = (await listDay(db, USER, '2026-07-10')).map((r) => r.raw_text);
    expect(texts).toEqual(['chai', 'roti', 'dal']); // earlier created_at wins the tie
    // and it is stable — the same query cannot come back the other way round
    expect((await listDay(db, USER, '2026-07-10')).map((r) => r.id)).toEqual([
      'first',
      'device-a',
      'device-b',
    ]);
    db.close();
  });

  it('identical timestamps still tie-break, by id', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'bbb', position: 0, raw_text: 'second', created_at: T0 }));
    await insertEntry(db, entry({ id: 'aaa', position: 0, raw_text: 'first', created_at: T0 }));
    expect((await listDay(db, USER, '2026-07-10')).map((r) => r.id)).toEqual(['aaa', 'bbb']);
    db.close();
  });

  it('the export bundle uses the same total order', async () => {
    const db = await openTestDb();
    await insertEntry(db, entry({ id: 'b', position: 0, created_at: T2, raw_text: 'later' }));
    await insertEntry(db, entry({ id: 'a', position: 0, created_at: T0, raw_text: 'earlier' }));
    expect((await listAllEntries(db, USER)).map((r) => r.raw_text)).toEqual(['earlier', 'later']);
    db.close();
  });
});

// Audit M6. The pull used to page with an offset over rows ordered by
// `updated_at` alone. That order is not total: a day flushed from offline, or
// the adoption re-home, stamps many rows inside the same millisecond. Rows
// sharing a value could fall either side of a page boundary and be skipped —
// and because the caller then advanced its watermark past them, they were never
// pulled again. Silent, permanent loss, surfacing as "my journal is gone" after
// a reinstall.
//
// These exercise the real loop (collectKeyset), not a mock of it, against a
// server model that returns rows in total order and honours a keyset cursor.
describe('sync: keyset pagination', () => {
  const PAGE = 1000;

  /** Server model: rows strictly after the cursor in (updated_at, key) order. */
  function server(rows: Record<string, SqlValue>[], keyColumn: string) {
    const sorted = [...rows].sort((a, b) => {
      const at = String(a['updated_at']);
      const bt = String(b['updated_at']);
      return at !== bt
        ? at.localeCompare(bt)
        : String(a[keyColumn]).localeCompare(String(b[keyColumn]));
    });
    let calls = 0;
    const fetchPage = async (cursor: SyncCursor | null, limit: number) => {
      calls++;
      const after = sorted.filter((r) => {
        if (!cursor) return true;
        const u = String(r['updated_at']);
        return (
          u > cursor.updatedAt || (u === cursor.updatedAt && String(r[keyColumn]) > cursor.key)
        );
      });
      return after.slice(0, limit);
    };
    return { fetchPage, calls: () => calls };
  }

  /** `id` is zero-padded so lexical order matches numeric order, as a uuid would not need. */
  function rows(count: number, updatedAt: (i: number) => string) {
    return Array.from({ length: count }, (_, i) => ({
      id: `e${String(i).padStart(5, '0')}`,
      updated_at: updatedAt(i),
    })) as Record<string, SqlValue>[];
  }

  it('loses nothing when 1,500 rows share one timestamp across a page boundary', async () => {
    // The exact shape that used to break: more rows than a page, all with an
    // identical updated_at, so `updated_at > watermark` can never advance.
    const all = rows(1500, () => T0);
    const { fetchPage } = server(all, 'id');

    const pulled = await collectKeyset(fetchPage, 'id', PAGE);

    expect(pulled).toHaveLength(1500);
    expect(new Set(pulled.map((r) => r['id'])).size).toBe(1500); // no duplicates
    expect(pulled.map((r) => r['id'])).toEqual(all.map((r) => r['id'])); // and in order
  });

  it('loses nothing when a page boundary lands inside a run of equal timestamps', async () => {
    // 999 distinct, then a 200-long run of one timestamp: the boundary at 1000
    // falls in the middle of the run.
    const all = rows(1199, (i) =>
      i < 999 ? `2026-07-10T00:00:${String(i % 60).padStart(2, '0')}.${i}Z` : T0,
    );
    const { fetchPage } = server(all, 'id');

    const pulled = await collectKeyset(fetchPage, 'id', PAGE);

    expect(pulled).toHaveLength(1199);
    expect(new Set(pulled.map((r) => r['id'])).size).toBe(1199);
  });

  it('terminates when the row count is an exact multiple of the page size', async () => {
    const { fetchPage, calls } = server(
      rows(2000, () => T0),
      'id',
    );

    const pulled = await collectKeyset(fetchPage, 'id', PAGE);

    expect(pulled).toHaveLength(2000);
    expect(calls()).toBe(3); // two full pages, then an empty one that ends it
  });

  it('resumes from a caller-supplied cursor without re-reading what came before', async () => {
    const all = rows(10, () => T0);
    const { fetchPage } = server(all, 'id');

    const pulled = await collectKeyset(fetchPage, 'id', PAGE, {
      updatedAt: T0,
      key: 'e00004',
    });

    expect(pulled.map((r) => r['id'])).toEqual(['e00005', 'e00006', 'e00007', 'e00008', 'e00009']);
  });

  it('makes exactly one call when the first page is short', async () => {
    const { fetchPage, calls } = server(
      rows(3, () => T0),
      'id',
    );
    expect(await collectKeyset(fetchPage, 'id', PAGE)).toHaveLength(3);
    expect(calls()).toBe(1);
  });

  it('returns nothing, and does not loop, when the table is empty', async () => {
    const { fetchPage, calls } = server([], 'id');
    expect(await collectKeyset(fetchPage, 'id', PAGE)).toEqual([]);
    expect(calls()).toBe(1);
  });

  it('stops rather than looping when a full page yields no usable cursor', async () => {
    // Defensive: a full page whose last row has no key would otherwise re-fetch
    // itself forever and hang the sync tick.
    let calls = 0;
    const fetchPage = async () => {
      calls++;
      return [{ updated_at: T0, id: null }] as unknown as Record<string, SqlValue>[];
    };
    expect(await collectKeyset(fetchPage, 'id', 1)).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it('takes the cursor from the last row, not the greatest timestamp', async () => {
    // Both rows share a timestamp; the tiebreaker key is what has to advance.
    const page = [
      { id: 'a', updated_at: T0 },
      { id: 'b', updated_at: T0 },
    ] as unknown as Record<string, SqlValue>[];
    expect(cursorOf(page, 'id')).toEqual({ updatedAt: T0, key: 'b' });
  });

  it('has no cursor for an empty page', () => {
    expect(cursorOf([], 'id')).toBeNull();
  });
});
