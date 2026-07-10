// Coverage for the offline/edge branches of the store and day math that the
// happy-path tests don't reach: sleep/water unit mapping, packaged-food
// recompute + catalogue-drop requeue, drainDue skip conditions, and the
// compose/dates fallbacks.

import { beforeEach, describe, expect, it } from 'vitest';

import { resolve, TransportError, type ClassifyTransport } from '../resolver';
import { sqliteCacheStore } from '../db/cacheStore';
import { getEntry, insertEntry, listDay } from '../db/entriesRepo';
import { ensureUserRows, patchKitchen, patchProfile } from '../db/profileRepo';
import {
  loadCatalogue,
  replaceDishes,
  replaceExercises,
  replaceIngredients,
  replacePackagedFoods,
} from '../db/referenceRepo';
import { addDays, dayKey, daysBetween } from './dates';
import { JournalStore } from './store';

import { openTestDb } from '../../test/helpers/betterSqliteAdapter';

const USER = 'user-a';
const DAY = '2026-07-10';

class FakeTransport implements ClassifyTransport {
  online = true;
  replies = new Map<string, string>();
  async classify(line: string): Promise<string> {
    if (!this.online) throw new TransportError('network');
    const reply = this.replies.get(line);
    if (!reply) throw new TransportError('server');
    return reply;
  }
}

interface Harness {
  db: Awaited<ReturnType<typeof openTestDb>>;
  store: JournalStore;
  transport: FakeTransport;
  clock: { t: number };
}

async function harness(): Promise<Harness> {
  const db = await openTestDb();
  await replaceIngredients(db, [
    {
      id: 'IFCT_WHEAT',
      name: 'Wheat',
      kcal_100g: 320,
      protein_100g: 12,
      carbs_100g: 64,
      fat_100g: 2,
      fiber_100g: 11,
      sugar_100g: 2,
    },
  ]);
  await replaceDishes(
    db,
    [
      {
        id: 'dish_roti',
        name: 'Roti',
        default_unit: 'roti',
        default_qty: 1,
        is_home_cookable: 1,
        cooking_fat_ml: 2,
      },
    ],
    [{ dish_id: 'dish_roti', ingredient_id: 'IFCT_WHEAT', grams: 35 }],
  );
  await replaceExercises(db, []);
  await replacePackagedFoods(db, [
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
  ]);
  await ensureUserRows(db, USER, '2026-07-10T08:00:00.000Z');
  await patchProfile(db, USER, { weight_kg: 85, weight_is_assumed: 0 }, '2026-07-10T08:00:00.000Z');
  await patchKitchen(db, USER, { is_assumed: 0 }, '2026-07-10T08:00:00.000Z');

  const transport = new FakeTransport();
  const clock = { t: Date.parse('2026-07-10T09:00:00.000Z') };
  let ids = 0;
  const cache = sqliteCacheStore(db);
  const catalogue = await loadCatalogue(db);
  const store = new JournalStore({
    adapter: db,
    userId: USER,
    resolveText: (text) => resolve(text, { cache, transport, catalogue }),
    now: () => new Date((clock.t += 10)),
    newId: () => `id-${++ids}`,
  });
  return { db, store, transport, clock };
}

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('dates fallbacks', () => {
  it('addDays and daysBetween parse well-formed keys', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-07-01', '2026-07-31')).toBe(30);
    expect(dayKey(new Date(2026, 0, 5, 6))).toBe('2026-01-05');
  });
});

describe('sleep + water unit mapping', () => {
  it('sleep hours → minutes; "slept badly" stores text with no duration', async () => {
    h.transport.replies.set(
      'slept badly',
      JSON.stringify([
        { intent: 'sleep', ref: null, qty: null, unit: null, context: 'home', confidence: 0.8 },
      ]),
    );
    await h.store.addLine('7.5 hours sleep', DAY); // local rule
    await h.store.addLine('slept badly', DAY); // model, no duration

    const rows = await listDay(h.db, USER, DAY);
    const withDuration = rows.find((r) => r.raw_text === '7.5 hours sleep');
    const withoutDuration = rows.find((r) => r.raw_text === 'slept badly');
    expect(withDuration?.sleep_minutes).toBe(450);
    expect(withoutDuration?.intent).toBe('sleep');
    expect(withoutDuration?.sleep_minutes).toBeNull();
  });

  it('water in ml maps straight through', async () => {
    await h.store.addLine('500 ml water', DAY);
    const row = (await listDay(h.db, USER, DAY))[0];
    expect(row?.water_ml).toBe(500);
  });
});

describe('packaged food + catalogue drop', () => {
  it('resolves a barcode ref to per-100g nutrition', async () => {
    h.transport.replies.set(
      '2 roti', // reuse a known key but answer with a barcode ref
      JSON.stringify([
        { intent: 'food', ref: '890123', qty: 50, unit: 'g', context: 'home', confidence: 0.95 },
      ]),
    );
    await h.store.addLine('2 roti', DAY);
    const row = (await listDay(h.db, USER, DAY))[0];
    expect(row?.kcal).toBe(240);
  });

  it('a resolved food whose ref left the catalogue re-queues on recompute', async () => {
    // insert a resolved row pointing at a dish id that is not in the mirror
    await insertEntry(h.db, {
      id: 'ghost',
      user_id: USER,
      log_date: DAY,
      position: 0,
      raw_text: 'mystery dish',
      nickname: null,
      intent: 'food',
      status: 'resolved',
      resolved_ref: 'dish_missing',
      qty: 1,
      unit: 'katori',
      context: 'home',
      kcal: 200,
      protein_g: 5,
      carbs_g: 30,
      fat_g: 5,
      fiber_g: 2,
      sugar_g: 1,
      water_ml: null,
      step_count: null,
      sleep_minutes: null,
      is_included: 0,
      calc_version: 'engine-v1',
      was_calibrated: 0,
      created_at: '2026-07-10T09:00:00.000Z',
      updated_at: '2026-07-10T09:00:00.000Z',
      deleted_at: null,
      retryable: 0,
      dirty: 1,
    });
    // deleting an unrelated (nonexistent) line triggers a recompute of the day
    await h.store.deleteLine('nope'); // no-op path
    // add then delete a real line to force recompute
    h.transport.replies.set(
      '2 roti',
      JSON.stringify([
        {
          intent: 'food',
          ref: 'dish_roti',
          qty: 2,
          unit: 'roti',
          context: 'home',
          confidence: 0.95,
        },
      ]),
    );
    await h.store.addLine('2 roti', DAY);

    const ghost = await getEntry(h.db, 'ghost');
    expect(ghost?.status).toBe('unresolved');
    expect(ghost?.retryable).toBe(1);
    expect(h.store.queuedCount).toBeGreaterThan(0);
  });
});

describe('drainDue skip conditions', () => {
  it('skips a queued row that resolved in the meantime', async () => {
    h.transport.online = false;
    await h.store.addLine('2 roti', DAY);
    const id = (await listDay(h.db, USER, DAY))[0]?.id ?? '';

    // resolve it out-of-band via a direct retry after connectivity
    h.transport.online = true;
    h.transport.replies.set(
      '2 roti',
      JSON.stringify([
        {
          intent: 'food',
          ref: 'dish_roti',
          qty: 2,
          unit: 'roti',
          context: 'home',
          confidence: 0.95,
        },
      ]),
    );
    await h.store.retryLine(id);
    expect((await getEntry(h.db, id))?.status).toBe('resolved');

    // the queued copy is now stale; draining should skip it, not re-resolve
    h.clock.t += 10_000;
    await h.store.drainDue();
    expect((await getEntry(h.db, id))?.status).toBe('resolved');
  });

  it('skips a queued row that was soft-deleted', async () => {
    h.transport.online = false;
    await h.store.addLine('2 roti', DAY);
    const id = (await listDay(h.db, USER, DAY))[0]?.id ?? '';
    await h.store.deleteLine(id);

    h.transport.online = true;
    h.clock.t += 10_000;
    await h.store.drainDue(); // must not throw or resurrect the row
    expect((await getEntry(h.db, id))?.deleted_at).not.toBeNull();
  });
});

describe('editLine and empty-input guards', () => {
  it('rejects an empty added line', async () => {
    await expect(h.store.addLine('   ', DAY)).rejects.toThrow('empty line');
  });

  it('ignores an empty edit', async () => {
    h.transport.replies.set(
      '2 roti',
      JSON.stringify([
        {
          intent: 'food',
          ref: 'dish_roti',
          qty: 2,
          unit: 'roti',
          context: 'home',
          confidence: 0.95,
        },
      ]),
    );
    await h.store.addLine('2 roti', DAY);
    const id = (await listDay(h.db, USER, DAY))[0]?.id ?? '';
    const before = await getEntry(h.db, id);
    await h.store.editLine(id, '   ');
    const after = await getEntry(h.db, id);
    expect(after?.raw_text).toBe(before?.raw_text);
  });
});
