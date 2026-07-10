// Phase-3 gate (build plan, spec/09): five lines typed with no network,
// force-quit, reopen, connectivity returns — every line resolves, in order,
// with the right totals. This is the automatable half of the gate; the
// on-device recording is Nirmal's half.
//
// "Force-quit" here is real: the SQLite file is closed, the store (and its
// in-memory retry queue) is thrown away, and a fresh process-equivalent
// reopens the same file and restores from what survived on disk.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { sqliteCacheStore } from '@/db/cacheStore';
import { listDay } from '@/db/entriesRepo';
import { ensureUserRows, patchKitchen, patchProfile } from '@/db/profileRepo';
import {
  loadCatalogue,
  replaceDishes,
  replaceExercises,
  replaceIngredients,
} from '@/db/referenceRepo';
import { JournalStore } from '@/journal/store';
import { resolve, TransportError, type ClassifyTransport } from '@/resolver';

import { openTestDb } from './helpers/betterSqliteAdapter';

const USER = 'user-airplane';
const DAY = '2026-07-10';

const FIVE_LINES = [
  '2 roti',
  '1 katori dal',
  'one cup chai',
  '9000 steps',
  '1 litre of water',
] as const;

// what the model answers once the network exists (keys are normalized text)
const MODEL_REPLIES = new Map<string, string>([
  [
    '2 roti',
    JSON.stringify([
      { intent: 'food', ref: 'dish_roti', qty: 2, unit: 'roti', context: 'home', confidence: 0.95 },
    ]),
  ],
  [
    '1 katori dal',
    JSON.stringify([
      {
        intent: 'food',
        ref: 'dish_dal',
        qty: 1,
        unit: 'katori',
        context: 'home',
        confidence: 0.95,
      },
    ]),
  ],
  [
    '1 cup chai',
    JSON.stringify([
      { intent: 'food', ref: 'dish_chai', qty: 1, unit: 'cup', context: 'home', confidence: 0.9 },
    ]),
  ],
]);

class Wire implements ClassifyTransport {
  online = false;
  order: string[] = [];
  async classify(line: string): Promise<string> {
    if (!this.online) throw new TransportError('network');
    this.order.push(line);
    const reply = MODEL_REPLIES.get(line);
    if (!reply) throw new TransportError('server');
    return reply;
  }
}

async function seed(db: Awaited<ReturnType<typeof openTestDb>>): Promise<void> {
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
    {
      id: 'IFCT_DAL',
      name: 'Red gram dal',
      kcal_100g: 330,
      protein_100g: 22,
      carbs_100g: 57,
      fat_100g: 2,
      fiber_100g: 9,
      sugar_100g: 1,
    },
    {
      id: 'IFCT_MILK',
      name: 'Toned milk',
      kcal_100g: 58,
      protein_100g: 3,
      carbs_100g: 5,
      fat_100g: 3,
      fiber_100g: null,
      sugar_100g: 5,
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
      {
        id: 'dish_dal',
        name: 'Dal',
        default_unit: 'katori',
        default_qty: 1,
        is_home_cookable: 1,
        cooking_fat_ml: 8,
      },
      {
        id: 'dish_chai',
        name: 'Chai',
        default_unit: 'cup',
        default_qty: 1,
        is_home_cookable: 1,
        cooking_fat_ml: 0,
      },
    ],
    [
      { dish_id: 'dish_roti', ingredient_id: 'IFCT_WHEAT', grams: 35 },
      { dish_id: 'dish_dal', ingredient_id: 'IFCT_DAL', grams: 60 },
      { dish_id: 'dish_chai', ingredient_id: 'IFCT_MILK', grams: 60 },
    ],
  );
  await replaceExercises(db, []);
}

describe('gate: airplane mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slate-airplane-'));
  const file = join(dir, 'slate.db');

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('5 offline lines survive force-quit and resolve in order with correct totals', async () => {
    const wire = new Wire();
    const clock = { t: Date.parse('2026-07-10T09:00:00.000Z') };
    let ids = 0;

    // ---- session 1: airplane mode ----
    {
      const db = await openTestDb(file);
      await seed(db);
      await ensureUserRows(db, USER, new Date(clock.t).toISOString());
      await patchProfile(
        db,
        USER,
        { sex: 'male', height_cm: 175, weight_kg: 85, weight_is_assumed: 0 },
        new Date(clock.t).toISOString(),
      );
      await patchKitchen(db, USER, { is_assumed: 0 }, new Date(clock.t).toISOString());

      const cache = sqliteCacheStore(db);
      const catalogue = await loadCatalogue(db);
      const store = new JournalStore({
        adapter: db,
        userId: USER,
        resolveText: (text) => resolve(text, { cache, transport: wire, catalogue }),
        now: () => new Date((clock.t += 25)),
        newId: () => `air-${++ids}`,
      });

      for (const line of FIVE_LINES) await store.addLine(line, DAY);

      const rows = await listDay(db, USER, DAY);
      expect(rows).toHaveLength(5);
      // steps + water resolve locally even offline; the three foods queue
      expect(rows.map((r) => r.status)).toEqual([
        'unresolved',
        'unresolved',
        'unresolved',
        'resolved',
        'resolved',
      ]);
      const view = await store.day(DAY);
      expect(view.totals.pendingCount).toBe(3);
      expect(view.totals.consumedKcal).toBe(0); // never a wrong total

      db.close(); // ---- force-quit ----
    }

    // ---- session 2: reopen, then connectivity returns ----
    {
      const db = await openTestDb(file);
      const cache = sqliteCacheStore(db);
      const catalogue = await loadCatalogue(db);
      const store = new JournalStore({
        adapter: db,
        userId: USER,
        resolveText: (text) => resolve(text, { cache, transport: wire, catalogue }),
        now: () => new Date((clock.t += 25)),
        newId: () => `air2-${++ids}`,
      });

      await store.restore(); // rebuild the queue from SQLite
      expect(store.queuedCount).toBe(3);

      // still offline: the queue holds, nothing breaks
      clock.t += 10_000;
      await store.drainDue();
      expect((await store.day(DAY)).totals.pendingCount).toBe(3);

      // connectivity returns
      wire.online = true;
      clock.t += 60_000;
      await store.drainDue();

      const rows = await listDay(db, USER, DAY);
      expect(rows.map((r) => r.status)).toEqual(Array(5).fill('resolved'));
      // resolved oldest-first, in typing order
      expect(wire.order).toEqual(['2 roti', '1 katori dal', '1 cup chai']);
      // journal order preserved
      expect(rows.map((r) => r.raw_text)).toEqual([...FIVE_LINES]);

      const view = await store.day(DAY);
      expect(view.totals.pendingCount).toBe(0);
      // right totals: three foods consumed, 9000 steps burned, 1L water
      expect(view.totals.consumedKcal).toBeGreaterThan(300);
      expect(view.totals.burnedKcal).toBeCloseTo((9000 - 3000) * 0.045 * (85 / 70), 6);
      expect(view.totals.waterMl).toBe(1000);
      expect(view.totals.netKcal).toBe(view.totals.consumedKcal - view.totals.burnedKcal);

      db.close();
    }
  });
});
