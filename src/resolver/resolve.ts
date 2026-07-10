// spec/05 pipeline, assembled: normalize → local rules → cache → model →
// validate → cache mirror. `resolve(text)` is the only public entry point and
// the model sits behind ClassifyTransport, so swapping providers touches one
// file (the transport implementation) and nothing here.
//
// Failure is a value, never an exception: every segment comes back either
// resolved or honestly `unresolved`, with `retryable` telling the journal
// whether the retry queue should pick it up (spec/09).

import { contextOf } from './context';
import { localRules } from './localRules';
import { normalize, splitEntries } from './normalize';
import type { Catalogue, Intent, Resolution, ResolverUnit } from './types';
import { UNRESOLVED } from './types';
import { validateModelOutput, validateResolution } from './validate';

export type TransportFailure = 'network' | 'rate_limit' | 'timeout' | 'server';

export class TransportError extends Error {
  constructor(readonly kind: TransportFailure) {
    super(`transport: ${kind}`);
    this.name = 'TransportError';
  }
}

/** One resolution_cache row, minus context — context is derived from text. */
export interface CachedResolution {
  intent: Intent;
  ref: string | null;
  qty: number | null;
  unit: ResolverUnit | null;
  confidence: number;
}

/**
 * Local SQLite mirror of the global resolution_cache. `put` updates the
 * mirror only — the authoritative global write happens server-side in the
 * classify Edge Function (service role; clients cannot write the table).
 */
export interface CacheStore {
  get(normalized: string): Promise<CachedResolution | null>;
  put(normalized: string, value: CachedResolution): Promise<void>;
}

/** The model, behind the Edge Function. Returns the raw reply text. */
export interface ClassifyTransport {
  classify(line: string): Promise<string>;
}

export interface ResolveDeps {
  cache: CacheStore;
  transport: ClassifyTransport;
  catalogue: Catalogue;
  /** spec/09: past this, the line queues for retry. */
  timeoutMs?: number;
}

export interface ResolvedSegment {
  /** what the user typed for this segment, as typed */
  raw: string;
  normalized: string;
  resolution: Resolution;
  source: 'cache' | 'rules' | 'model';
  /** true when a retry might succeed (network/timeout/rate limit) */
  retryable: boolean;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Longest key the cache will hold (security review F1). The >90% hit rate
 * lives entirely in short head-of-distribution phrases ("2 roti", "chai");
 * long unique keys are the cache-fill vector. Mirrored server-side in
 * resolver_cache_write.
 */
export const MAX_CACHE_KEY_LENGTH = 64;

function withTimeout(work: Promise<string>, ms: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new TransportError('timeout')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * A model resolution may enter the cache only if a later cache hit would
 * reproduce it exactly: one resolution per key (the row holds one), resolved,
 * and a context the token scan can reconstruct. Anything else stays uncached
 * rather than becoming a different answer tomorrow.
 */
function cacheable(resolutions: Resolution[], normalized: string): CachedResolution | null {
  if (normalized.length > MAX_CACHE_KEY_LENGTH) return null;
  if (resolutions.length !== 1) return null;
  const r = resolutions[0]!;
  if (r.intent === 'unresolved') return null;
  if (contextOf(normalized) !== r.context) return null;
  return { intent: r.intent, ref: r.ref, qty: r.qty, unit: r.unit, confidence: r.confidence };
}

async function resolveSegment(raw: string, deps: ResolveDeps): Promise<ResolvedSegment[]> {
  const normalized = normalize(raw);
  const base = { raw, normalized };

  const ruled = localRules(normalized);
  if (ruled) return [{ ...base, resolution: ruled, source: 'rules', retryable: false }];

  // A cache row clears the same gate as model output (poisoned global row,
  // tampered local mirror, or a ref that has since left the catalogue). A row
  // that fails is treated as a miss, not as an unresolved line.
  const cached = await deps.cache.get(normalized);
  if (cached) {
    const resolution = validateResolution(
      { ...cached, context: contextOf(normalized) },
      deps.catalogue,
    );
    if (resolution.intent !== 'unresolved') {
      return [{ ...base, resolution, source: 'cache', retryable: false }];
    }
  }

  let reply: string;
  try {
    reply = await withTimeout(
      deps.transport.classify(normalized),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  } catch {
    // Offline, rate-limited, timed out, or something unforeseen: all of them
    // are "try again later", none of them are the user's problem.
    return [{ ...base, resolution: UNRESOLVED, source: 'model', retryable: true }];
  }

  const resolutions = validateModelOutput(reply, deps.catalogue);
  const mirror = cacheable(resolutions, normalized);
  if (mirror) await deps.cache.put(normalized, mirror);

  return resolutions.map((resolution) => ({
    ...base,
    resolution,
    source: 'model' as const,
    retryable: false,
  }));
}

/** The resolver. One journal line in, one ResolvedSegment per entry out. */
export async function resolve(text: string, deps: ResolveDeps): Promise<ResolvedSegment[]> {
  const segments = splitEntries(text);
  const settled = await Promise.all(segments.map((segment) => resolveSegment(segment, deps)));
  return settled.flat();
}
