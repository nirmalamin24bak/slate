import { beforeEach, describe, expect, it } from 'vitest';

import { resolve, TransportError, type ClassifyTransport } from '../resolver';
import { sqliteCacheStore } from '../db/cacheStore';
import { getEntry, listDay } from '../db/entriesRepo';
import { ensureUserRows, getProfile, patchKitchen, patchProfile } from '../db/profileRepo';
import {
  loadCatalogue,
  replaceDishes,
  replaceExercises,
  replaceIngredients,
} from '../db/referenceRepo';
import type { WeightRow } from '../db/rows';
import { metBurn, stepsBurn } from '../engine';
import { JournalStore, type JournalEvent } from './store';

import { openTestDb } from '../../test/helpers/betterSqliteAdapter';

const USER = 'user-a';
const DAY = '2026-07-10';

/** The model behind the Edge Function, scripted. Offline throws like the wire does. */
class FakeTransport implements ClassifyTransport {
  online = true;
  calls: string[] = [];
  replies = new Map<string, string>();

  async classify(line: string): Promise<string> {
    if (!this.online) throw new TransportError('network');
    this.calls.push(line);
    const reply = this.replies.get(line);
    if (!reply) throw new TransportError('server');
    return reply;
  }
}

function reply(intent: string, ref: string | null, qty: number, unit: string): string {
  return JSON.stringify([{ intent, ref, qty, unit, context: 'home', confidence: 0.95 }]);
}

async function seedReference(db: Awaited<ReturnType<typeof openTestDb>>): Promise<void> {
  await replaceIngredients(db, [
    {
      id: 'IFCT_WHEAT',
      name: 'Wheat flour',
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
  await replaceExercises(db, [
    { id: 'ex_walk', name: 'Walking', met: 3.5, unit: 'minutes', is_ambulatory: 1 },
  ]);
}

interface Harness {
  db: Awaited<ReturnType<typeof openTestDb>>;
  store: JournalStore;
  transport: FakeTransport;
  clock: { t: number };
  events: JournalEvent[];
}

async function harness(): Promise<Harness> {
  const db = await openTestDb();
  await seedReference(db);
  await ensureUserRows(db, USER, '2026-07-10T08:00:00.000Z');
  await patchProfile(
    db,
    USER,
    { sex: 'male', height_cm: 175, weight_kg: 85, weight_is_assumed: 0 },
    '2026-07-10T08:00:00.000Z',
  );
  await patchKitchen(db, USER, { is_assumed: 0 }, '2026-07-10T08:00:00.000Z');

  const transport = new FakeTransport();
  transport.replies.set('2 roti', reply('food', 'dish_roti', 2, 'roti'));
  // the resolver normalizes before classify: 'min' → 'minutes'
  transport.replies.set('45 minutes walk', reply('exercise', 'ex_walk', 45, 'minutes'));

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
  const events: JournalEvent[] = [];
  store.on((e) => events.push(e));
  return { db, store, transport, clock, events };
}

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('JournalStore — resolution flows', () => {
  it('resolves a food line end-to-end: model → engine → totals', async () => {
    await h.store.addLine('2 roti', DAY);
    const view = await h.store.day(DAY);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]?.display.kind).toBe('kcal');
    expect(view.totals.consumedKcal).toBeGreaterThan(200);
    expect(view.totals.pendingCount).toBe(0);
  });

  it('local rules resolve without touching the model', async () => {
    await h.store.addLine('9000 steps', DAY);
    await h.store.addLine('1 litre of water', DAY);
    expect(h.transport.calls).toHaveLength(0);
    const view = await h.store.day(DAY);
    expect(view.totals.burnedKcal).toBeGreaterThan(0);
    expect(view.totals.waterMl).toBe(1000);
  });

  it('splits a conjunction line into two entries in order', async () => {
    h.transport.replies.set('1 katori dal', reply('food', 'dish_roti', 1, 'katori'));
    await h.store.addLine('2 roti aur 1 katori dal', DAY);
    const rows = await listDay(h.db, USER, DAY);
    expect(rows.map((r) => r.raw_text)).toEqual(['2 roti', '1 katori dal']);
    expect(rows.map((r) => r.status)).toEqual(['resolved', 'resolved']);
  });

  it('second identical line hits the local cache mirror, not the model', async () => {
    await h.store.addLine('2 roti', DAY);
    await h.store.addLine('2 roti', DAY);
    expect(h.transport.calls).toEqual(['2 roti']);
  });

  it('steps + 45 min walk on one day: one burn, the smaller line included', async () => {
    await h.store.addLine('9000 steps', DAY);
    await h.store.addLine('45 min walk', DAY);
    const view = await h.store.day(DAY);
    const kinds = view.lines.map((l) => l.display.kind);
    expect(kinds).toContain('burn');
    expect(kinds).toContain('included');
    // count the LARGER (steps here), exactly — not the sum, not the walk
    expect(view.totals.burnedKcal).toBeCloseTo(stepsBurn(9000, 85), 6);
    expect(view.totals.burnedKcal).toBeGreaterThan(metBurn(3.5, 85, 45));
  });
});

describe('JournalStore — offline + retry', () => {
  it('offline line stays typed, unresolved, queued; drains when connectivity returns', async () => {
    h.transport.online = false;
    await h.store.addLine('2 roti', DAY);

    let view = await h.store.day(DAY);
    expect(view.lines[0]?.display.kind).toBe('retry');
    expect(view.totals.pendingCount).toBe(1);
    expect(h.store.queuedCount).toBe(1);

    // back online, but before backoff expiry nothing drains
    h.transport.online = true;
    await h.store.drainDue();
    expect((await h.store.day(DAY)).totals.pendingCount).toBe(1);

    h.clock.t += 5000;
    await h.store.drainDue();
    view = await h.store.day(DAY);
    expect(view.lines[0]?.display.kind).toBe('kcal');
    expect(h.store.queuedCount).toBe(0);
  });

  it('repeated failure backs off and requeues', async () => {
    h.transport.online = false;
    await h.store.addLine('2 roti', DAY);
    h.clock.t += 5000;
    await h.store.drainDue(); // still offline → requeued with attempt+1
    expect(h.store.queuedCount).toBe(1);

    h.transport.online = true;
    h.clock.t += 1500; // attempt-1 backoff is 2s — not due yet
    await h.store.drainDue();
    expect((await h.store.day(DAY)).totals.pendingCount).toBe(1);

    h.clock.t += 5000;
    await h.store.drainDue();
    expect((await h.store.day(DAY)).totals.pendingCount).toBe(0);
  });

  it('tapping an unresolved line retries immediately', async () => {
    h.transport.online = false;
    await h.store.addLine('2 roti', DAY);
    h.transport.online = true;
    const id = (await listDay(h.db, USER, DAY))[0]?.id ?? '';
    await h.store.retryLine(id);
    expect((await h.store.day(DAY)).lines[0]?.display.kind).toBe('kcal');
  });
});

describe('JournalStore — weight edge cases', () => {
  it('writes weight + profile for a small delta', async () => {
    await h.store.addLine('weight 84', DAY);
    const weights = await h.db.all<WeightRow>('SELECT * FROM weights');
    expect(weights[0]?.weight_kg).toBe(84);
    expect((await getProfile(h.db, USER))?.weight_kg).toBe(84);
  });

  it('>5kg delta asks before writing; accept writes, nothing written before', async () => {
    await h.store.addLine('weight 105', DAY);
    expect(await h.db.all('SELECT * FROM weights')).toHaveLength(0);
    const confirm = h.events.find((e) => e.type === 'weightConfirm');
    expect(confirm).toMatchObject({ newKg: 105, prevKg: 85 });

    await h.store.confirmWeight((confirm as { entryId: string }).entryId, true);
    expect((await getProfile(h.db, USER))?.weight_kg).toBe(105);
  });

  it('declined confirm leaves stored weight alone', async () => {
    await h.store.addLine('weight 105', DAY);
    const confirm = h.events.find((e) => e.type === 'weightConfirm');
    await h.store.confirmWeight((confirm as { entryId: string }).entryId, false);
    expect((await getProfile(h.db, USER))?.weight_kg).toBe(85);
    expect(await h.db.all('SELECT * FROM weights')).toHaveLength(0);
  });

  it('prompts once for body weight when exercise logs against an assumed weight', async () => {
    await patchProfile(h.db, USER, { weight_is_assumed: 1 }, '2026-07-10T08:30:00.000Z');
    await h.store.addLine('45 min walk', DAY);
    await h.store.addLine('9000 steps', DAY);
    expect(h.events.filter((e) => e.type === 'needsWeight')).toHaveLength(1);

    await h.store.provideBodyWeight(90, DAY);
    const profile = await getProfile(h.db, USER);
    expect(profile?.weight_kg).toBe(90);
    expect(profile?.weight_is_assumed).toBe(0);
    // burn recomputed with the REAL 90kg, not the 65kg assumed fallback
    const view = await h.store.day(DAY);
    expect(view.totals.burnedKcal).toBeCloseTo(stepsBurn(9000, 90), 6);
    expect(view.totals.burnedKcal).not.toBeCloseTo(stepsBurn(9000, 65), 1);
  });
});

describe('JournalStore — line editing', () => {
  it('nickname saves a line', async () => {
    await h.store.addLine('2 roti', DAY);
    const id = (await listDay(h.db, USER, DAY))[0]?.id ?? '';
    await h.store.setNickname(id, 'breakfast roti');
    expect((await getEntry(h.db, id))?.nickname).toBe('breakfast roti');
  });

  it('editing re-resolves the line', async () => {
    await h.store.addLine('2 roti', DAY);
    const id = (await listDay(h.db, USER, DAY))[0]?.id ?? '';
    await h.store.editLine(id, '9000 steps');
    const row = await getEntry(h.db, id);
    expect(row?.intent).toBe('steps');
    expect(row?.step_count).toBe(9000);
  });

  it('soft delete removes the line from the day and its totals', async () => {
    await h.store.addLine('2 roti', DAY);
    const id = (await listDay(h.db, USER, DAY))[0]?.id ?? '';
    await h.store.deleteLine(id);
    const view = await h.store.day(DAY);
    expect(view.lines).toHaveLength(0);
    expect(view.totals.consumedKcal).toBe(0);
  });
});

// The store is the only thing the journal screen subscribes to. These are the
// seams the UI depends on and nothing exercised: who gets told when a row
// changes, that unsubscribing actually stops it, and that a re-homed session
// keeps writing under the new uid rather than the placeholder.
describe('JournalStore — the subscription contract', () => {
  it('emitChange notifies every listener, and unsubscribing stops it', () => {
    const seen: JournalEvent[] = [];
    const off = h.store.on((e) => seen.push(e));

    h.store.emitChange();
    expect(seen).toEqual([{ type: 'change' }]);

    off();
    h.store.emitChange();
    expect(seen).toHaveLength(1); // the unsubscribed listener heard nothing more
    // the harness listener is still attached, so the store itself still emits
    expect(h.events.filter((e) => e.type === 'change')).toHaveLength(2);
  });

  it('recomputeToday refreshes the open day and tells the screen to re-read', async () => {
    await h.store.addLine('2 roti', DAY);
    const before = h.events.length;

    await h.store.recomputeToday(DAY);

    expect(h.events.length).toBeGreaterThan(before);
    expect(h.events.at(-1)).toEqual({ type: 'change' });
    // and the day still reads correctly afterwards
    expect((await h.store.day(DAY)).totals.consumedKcal).toBeGreaterThan(200);
  });

  it('reassignUser re-homes writes onto the adopted session', async () => {
    // Offline install: rows land under a placeholder uid, the anonymous
    // session arrives later, the services layer rewrites the existing rows and
    // calls this so the NEXT write goes to the real user (spec/09).
    h.store.reassignUser('user-adopted');
    await h.store.addLine('9000 steps', DAY);

    const rows = await listDay(h.db, 'user-adopted', DAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe('user-adopted');
    // nothing new landed under the old identity
    expect(await listDay(h.db, USER, DAY)).toHaveLength(0);
  });

  it('a listener added twice is held once — no duplicate notifications', () => {
    const seen: JournalEvent[] = [];
    const listener = (e: JournalEvent) => seen.push(e);
    h.store.on(listener);
    h.store.on(listener);
    h.store.emitChange();
    expect(seen).toHaveLength(1);
  });
});
