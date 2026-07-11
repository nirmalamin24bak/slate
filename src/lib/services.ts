// App-level wiring: one database, one journal store, one resolver pipeline.
// Pure modules stay pure; this is the only place they meet the network, the
// native SQLite file, and the auth session.

import { openDatabase } from '../db/expo';
import { adoptPendingUser, PENDING_USER_ID } from '../db/adoption';
import type { SqlAdapter, SqlValue } from '../db/adapter';
import { sqliteCacheStore } from '../db/cacheStore';
import { ensureUserRows } from '../db/profileRepo';
import { loadCatalogue } from '../db/referenceRepo';
import { pullReference, pullUserData, pushDirty, type RemoteDb } from '../db/sync';
import { JournalStore } from '../journal/store';
import { resolve } from '../resolver';
import { edgeTransport } from '../resolver/transport';
import { refreshServerEntitlement } from './entitlementSync';
import { newId } from './ids';
import { reportError } from './report';
import { configurePurchases } from './revenuecat';
import { supabase, ensureAnonymousSession } from './supabase';

// Offline install (spec/09): rows are written under PENDING_USER_ID until the
// anonymous session arrives, then adopted. The re-home logic is pure and lives
// in src/db/adoption.ts (re-exported here for callers that had it before).
export { PENDING_USER_ID } from '../db/adoption';

// User-owned tables push through updated_at-guarded RPCs (migration
// 20260711000006) so a stale device cannot overwrite a newer server row.
// Reference mirrors are select-only and keep the plain upsert.
const GUARDED_UPSERT: Record<string, string> = {
  entries: 'sync_upsert_entries',
  weights: 'sync_upsert_weights',
  profiles: 'sync_upsert_profiles',
  kitchen: 'sync_upsert_kitchen',
};

const PAGE_SIZE = 1000; // supabase-js caps a select at 1000; page past it.

const supabaseRemote: RemoteDb = {
  async upsert(table, rows) {
    const rpc = GUARDED_UPSERT[table];
    if (rpc) {
      const { error } = await supabase.rpc(rpc, { rows });
      if (error) throw new Error(`sync push ${table}: ${error.message}`);
      return;
    }
    const { error } = await supabase.from(table).upsert(rows as Record<string, SqlValue>[]);
    if (error) throw new Error(`sync push ${table}: ${error.message}`);
  },
  async fetchAll(table, columns) {
    const { data, error } = await supabase.from(table).select(columns);
    if (error) throw new Error(`sync pull ${table}: ${error.message}`);
    return (data ?? []) as unknown as Record<string, SqlValue>[];
  },
  async fetchOwned(table, userId) {
    const all: Record<string, SqlValue>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('user_id', userId)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`sync pull ${table}: ${error.message}`);
      const page = (data ?? []) as unknown as Record<string, SqlValue>[];
      all.push(...page);
      if (page.length < PAGE_SIZE) break; // short page = last page
    }
    return all;
  },
};

export interface Services {
  adapter: SqlAdapter;
  store: JournalStore;
  userId: string;
  /** drain the retry queue + push dirty rows; safe to call on any tick */
  syncTick(): Promise<void>;
  /** re-read the authoritative entitlement row (call on app foreground) */
  refreshEntitlement(): Promise<void>;
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
  if (sessionUserId) {
    void configurePurchases(sessionUserId);
    void refreshServerEntitlement(supabase); // authoritative Plus from the server
  }

  // Reference mirrors: refresh best-effort; a stale mirror still works and
  // an empty one degrades lines to unresolved, honestly.
  try {
    await pullReference(adapter, supabaseRemote);
  } catch (error) {
    reportError(error, { op: 'pullReference' });
  }

  // User data down-sync (spec/04): hydrate this device from the server so a
  // reinstall or a second device shows the full journal instead of nothing.
  // Best-effort; a locally-dirty row is never clobbered.
  if (sessionUserId) {
    try {
      await pullUserData(adapter, supabaseRemote, sessionUserId);
    } catch (error) {
      reportError(error, { op: 'pullUserData' });
    }
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
    void refreshServerEntitlement(supabase);
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
          // Pull after push so a multi-device edit converges the same tick.
          await pullUserData(adapter, supabaseRemote, currentUserId);
          store.emitChange();
        } catch (error) {
          reportError(error, { op: 'syncTick' });
        }
      }
    },
    async refreshEntitlement() {
      await refreshServerEntitlement(supabase);
    },
  };
}

export function services(): Promise<Services> {
  servicesPromise ??= build();
  return servicesPromise;
}
