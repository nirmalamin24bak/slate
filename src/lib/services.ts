// App-level wiring: one database, one journal store, one resolver pipeline.
// Pure modules stay pure; this is the only place they meet the network, the
// native SQLite file, and the auth session.

import { openDatabase } from '../db/expo';
import { adoptPendingUser, PENDING_USER_ID } from '../db/adoption';
import type { SqlAdapter, SqlValue } from '../db/adapter';
import { sqliteCacheStore } from '../db/cacheStore';
import { ensureUserRows } from '../db/profileRepo';
import { loadCatalogue } from '../db/referenceRepo';
import { pullReference, pushDirty, type RemoteDb } from '../db/sync';
import { JournalStore } from '../journal/store';
import { resolve } from '../resolver';
import { edgeTransport } from '../resolver/transport';
import { newId } from './ids';
import { configurePurchases } from './revenuecat';
import { supabase, ensureAnonymousSession } from './supabase';

// Offline install (spec/09): rows are written under PENDING_USER_ID until the
// anonymous session arrives, then adopted. The re-home logic is pure and lives
// in src/db/adoption.ts (re-exported here for callers that had it before).
export { PENDING_USER_ID } from '../db/adoption';

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

  // Alias the RevenueCat anonymous ID to auth.uid() (spec/07) — entitlement
  // and data share an identity. Never with the placeholder id; the offline
  // install path configures on adoption instead. Non-blocking: the journal
  // must not wait on StoreKit.
  if (sessionUserId) void configurePurchases(sessionUserId);

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

  // Mutable across the slow-network-install path: starts PENDING if the
  // anonymous sign-in hasn't landed yet, becomes the real uid on adoption.
  let currentUserId = userId;

  const store = new JournalStore({
    adapter,
    userId: currentUserId,
    resolveText: (text) => resolve(text, { cache, transport, catalogue }),
    now: () => new Date(),
    newId,
  });
  await store.restore();

  /**
   * If we booted before the anonymous session existed (offline/slow install),
   * adopt the placeholder rows the moment the session appears — not only at
   * build (spec/09: flush "the moment a session exists"). Idempotent no-op
   * once adopted.
   */
  async function ensureAdopted(): Promise<void> {
    if (currentUserId !== PENDING_USER_ID) return;
    await ensureAnonymousSession();
    const { data } = await supabase.auth.getSession();
    const realId = data.session?.user.id;
    if (!realId) return;
    await adoptPendingUser(adapter, realId);
    currentUserId = realId;
    store.reassignUser(realId);
    void configurePurchases(realId);
  }

  return {
    adapter,
    store,
    get userId() {
      return currentUserId;
    },
    async syncTick() {
      await store.drainDue();
      await ensureAdopted();
      if (currentUserId !== PENDING_USER_ID) {
        try {
          await pushDirty(adapter, supabaseRemote, currentUserId);
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
