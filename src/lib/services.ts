// App-level wiring: one database, one journal store, one resolver pipeline.
// Pure modules stay pure; this is the only place they meet the network, the
// native SQLite file, and the auth session.

import { openDatabase } from '../db/expo';
import type { SqlAdapter, SqlValue } from '../db/adapter';
import { sqliteCacheStore } from '../db/cacheStore';
import { ensureUserRows } from '../db/profileRepo';
import { loadCatalogue } from '../db/referenceRepo';
import { pullReference, pushDirty, type RemoteDb } from '../db/sync';
import { JournalStore } from '../journal/store';
import { resolve } from '../resolver';
import { edgeTransport } from '../resolver/transport';
import { newId } from './ids';
import { supabase, ensureAnonymousSession } from './supabase';

/**
 * Offline install (spec/09): no session yet, so rows are written under this
 * placeholder and adopted the moment the anonymous session exists. Sync
 * never pushes placeholder rows.
 */
export const PENDING_USER_ID = 'pending-anon';

export async function adoptPendingUser(adapter: SqlAdapter, userId: string): Promise<void> {
  for (const table of ['entries', 'weights', 'profiles', 'kitchen']) {
    await adapter.run(`UPDATE ${table} SET user_id = ?, dirty = 1 WHERE user_id = ?`, [
      userId,
      PENDING_USER_ID,
    ]);
  }
}

const supabaseRemote: RemoteDb = {
  async upsert(table, rows) {
    const { error } = await supabase.from(table).upsert(rows as Record<string, SqlValue>[]);
    if (error) throw new Error(`sync push ${table}: ${error.message}`);
  },
  async fetchAll(table, columns) {
    const { data, error } = await supabase.from(table).select(columns);
    if (error) throw new Error(`sync pull ${table}: ${error.message}`);
    return (data ?? []) as unknown as Record<string, SqlValue>[];
  },
};

export interface Services {
  adapter: SqlAdapter;
  store: JournalStore;
  userId: string;
  /** drain the retry queue + push dirty rows; safe to call on any tick */
  syncTick(): Promise<void>;
}

let servicesPromise: Promise<Services> | null = null;

async function build(): Promise<Services> {
  const adapter = await openDatabase();

  await ensureAnonymousSession();
  const { data } = await supabase.auth.getSession();
  const sessionUserId = data.session?.user.id ?? null;
  const userId = sessionUserId ?? PENDING_USER_ID;
  if (sessionUserId) await adoptPendingUser(adapter, sessionUserId);
  await ensureUserRows(adapter, userId, new Date().toISOString());

  // Reference mirrors: refresh best-effort; a stale mirror still works and
  // an empty one degrades lines to unresolved, honestly.
  try {
    await pullReference(adapter, supabaseRemote);
  } catch (error) {
    console.warn('slate: reference pull deferred:', error);
  }

  const cache = sqliteCacheStore(adapter);
  const catalogue = await loadCatalogue(adapter);
  const transport = edgeTransport({
    invoke: (name, options) =>
      supabase.functions.invoke(name, { body: options.body as Record<string, unknown> }),
  });

  const store = new JournalStore({
    adapter,
    userId,
    resolveText: (text) => resolve(text, { cache, transport, catalogue }),
    now: () => new Date(),
    newId,
  });
  await store.restore();

  return {
    adapter,
    store,
    userId,
    async syncTick() {
      await store.drainDue();
      if (userId !== PENDING_USER_ID) {
        try {
          await pushDirty(adapter, supabaseRemote);
        } catch (error) {
          console.warn('slate: push deferred:', error);
        }
      }
    },
  };
}

export function services(): Promise<Services> {
  servicesPromise ??= build();
  return servicesPromise;
}
