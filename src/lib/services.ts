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
import {
  resolve,
  TransportError,
  type ClassifyTransport,
  type ResolvedSegment,
  type ResolveDeps,
} from '../resolver';
import { edgeTransport } from '../resolver/transport';
import { configureAnalytics, confidenceBucket, track } from './analytics';
import { refreshServerEntitlement } from './entitlementSync';
import { newId } from './ids';
import { getRemoteConfig, refreshRemoteConfig } from './remoteConfig';
import { reportError } from './report';
import { recordSyncFailure, recordSyncSuccess } from './syncHealth';
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
  async fetchOwned(table, userId, since) {
    const all: Record<string, SqlValue>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      // Delta pull: order by updated_at and only take rows newer than the
      // device's watermark. Soft-deletes bump updated_at, so tombstones ride
      // the same delta — no separate deletion channel needed.
      let query = supabase
        .from(table)
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: true });
      if (since != null) query = query.gt('updated_at', since);
      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`sync pull ${table}: ${error.message}`);
      const page = (data ?? []) as unknown as Record<string, SqlValue>[];
      all.push(...page);
      if (page.length < PAGE_SIZE) break; // short page = last page
    }
    return all;
  },
};

/**
 * The one place a resolved line becomes a product event. Both numbers the
 * week-8 dashboard is built on come from here: `unresolved_rate` and resolver
 * p95 (spec/10). Wrapping the store's resolveText rather than instrumenting
 * inside resolve() keeps the resolver pure and testable with no analytics.
 *
 * Nothing derived from what the user typed is sent (spec/08). `entry_unresolved`
 * carries the *length* of the normalized text, so a failure on "2 roti" can be
 * told apart from one on a paragraph, without either string.
 */
async function resolveAndTrack(text: string, deps: ResolveDeps): Promise<ResolvedSegment[]> {
  const startedAt = Date.now();
  const segments = await resolve(text, deps);
  const resolveMs = Date.now() - startedAt;
  for (const segment of segments) {
    const { intent, ref, confidence } = segment.resolution;
    if (intent === 'unresolved') {
      track({ name: 'entry_unresolved', normalized_len: segment.normalized.length });
    } else {
      track({
        name: 'entry_resolved',
        intent,
        ref,
        confidence_bucket: confidenceBucket(confidence),
        resolve_ms: resolveMs,
        source: segment.source,
      });
    }
  }
  return segments;
}

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
    // Same id for analytics (docs/analytics-handoff.md: identify(auth.uid())
    // only, no traits) so product events and purchases line up without a
    // second identifier. Inert unless the PostHog key and host are both set.
    configureAnalytics(sessionUserId);
    void configurePurchases(sessionUserId);
    void refreshServerEntitlement(supabase); // authoritative Plus from the server
    void refreshRemoteConfig(supabase); // breach banner + resolver flag
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
  const edge = edgeTransport({
    invoke: (name, options) =>
      supabase.functions.invoke(name, { body: options.body as Record<string, unknown> }),
  });
  // Client-side kill switch: when remote config turns the resolver off, skip
  // the network entirely and surface the same non-retryable 'disabled' failure
  // the server 503 would — the pipeline falls back to cache + local rules
  // without hammering a resolver we already know is off (plan A5/F7).
  const transport: ClassifyTransport = {
    async classify(line: string) {
      if (!getRemoteConfig().resolverEnabled) throw new TransportError('disabled');
      return edge.classify(line);
    },
  };

  // Mutable across the slow-network-install path: starts PENDING if the
  // anonymous sign-in hasn't landed yet, becomes the real uid on adoption.
  let currentUserId = userId;

  // Re-entrancy guard (audit B3): the interval, the net-state listener, and the
  // settings screens all call syncTick; overlapping ticks race the
  // dirty→push→mark cycle. A tick in flight makes concurrent callers no-op —
  // the next tick catches whatever remained dirty, so nothing is dropped.
  let isSyncing = false;

  const store = new JournalStore({
    adapter,
    userId: currentUserId,
    resolveText: (text) => resolveAndTrack(text, { cache, transport, catalogue }),
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
    configureAnalytics(realId);
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
      if (isSyncing) return; // B3: a tick is already running; it covers this one.
      isSyncing = true;
      try {
        await store.drainDue();
        await ensureAdopted();
        if (currentUserId !== PENDING_USER_ID) {
          try {
            await pushDirty(adapter, supabaseRemote, currentUserId);
            // Pull after push so a multi-device edit converges the same tick.
            await pullUserData(adapter, supabaseRemote, currentUserId);
            store.emitChange();
            // B4: a full push+pull got through — data is reaching the server.
            recordSyncSuccess(Date.now());
          } catch (error) {
            // B4: don't just swallow into a prod no-op. Count the failure so a
            // permanently-stuck (e.g. poison-row) sync surfaces as "not backed
            // up" instead of silently losing data on reinstall.
            reportError(error, { op: 'syncTick' });
            recordSyncFailure();
          }
        }
      } finally {
        isSyncing = false;
      }
    },
    async refreshEntitlement() {
      await Promise.all([refreshServerEntitlement(supabase), refreshRemoteConfig(supabase)]);
    },
  };
}

export function services(): Promise<Services> {
  servicesPromise ??= build();
  return servicesPromise;
}
