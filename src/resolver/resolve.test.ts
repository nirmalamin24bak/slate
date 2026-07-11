import { describe, expect, it, vi } from 'vitest';

import type { CachedResolution, CacheStore, ClassifyTransport } from './resolve';
import { resolve, TransportError } from './resolve';
import type { Catalogue } from './types';

// spec/05 pipeline: normalize → cache → (local rules) → LLM classify →
// validate → cache write. resolve() is the one public entry point,
// resolve(text) → segments; the model sits behind ClassifyTransport so it is
// swappable in one file. Failures are honest: unresolved + retryable flag,
// never an exception, never a guess.

const catalogue: Catalogue = {
  dishes: new Set(['dish_rajma', 'dish_dal', 'dish_roti']),
  exercises: new Set(['ex_walk']),
  packagedFoods: new Set<string>(),
  customDishes: new Set<string>(),
};

const rajma = {
  intent: 'food',
  ref: 'dish_rajma',
  qty: 1,
  unit: 'katori',
  context: 'home',
  confidence: 0.94,
};

function memoryCache(seed: Record<string, CachedResolution> = {}): CacheStore & {
  puts: { key: string; value: CachedResolution }[];
} {
  const rows = new Map(Object.entries(seed));
  const puts: { key: string; value: CachedResolution }[] = [];
  return {
    puts,
    get: (key) => Promise.resolve(rows.get(key) ?? null),
    put: (key, value) => {
      puts.push({ key, value });
      rows.set(key, value);
      return Promise.resolve();
    },
  };
}

function transportOf(reply: string): ClassifyTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    classify: (line) => {
      calls.push(line);
      return Promise.resolve(reply);
    },
  };
}

const deps = (cache: CacheStore, transport: ClassifyTransport) => ({
  cache,
  transport,
  catalogue,
});

describe('resolve — cache path', () => {
  it('a cache hit never calls the model', async () => {
    const cache = memoryCache({
      '2 roti': { intent: 'food', ref: 'dish_roti', qty: 2, unit: 'roti', confidence: 0.99 },
    });
    const transport = transportOf('{}');
    const out = await resolve('2 Roti!', deps(cache, transport));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'cache',
      resolution: { intent: 'food', ref: 'dish_roti', qty: 2 },
    });
    expect(transport.calls).toEqual([]);
  });

  it('reconstructs context from text on a cache hit (cache has no context column)', async () => {
    const cache = memoryCache({
      'dal from swiggy': {
        intent: 'food',
        ref: 'dish_dal',
        qty: 1,
        unit: 'katori',
        confidence: 0.9,
      },
    });
    const out = await resolve('dal from swiggy', deps(cache, transportOf('{}')));
    expect(out[0]!.resolution.context).toBe('outside');
  });
});

describe('resolve — cache hits are validated (security F2)', () => {
  it('a hostile cached row is not served; the model is consulted instead', async () => {
    // Cache hits used to skip validateModelOutput entirely, so a poisoned
    // global row (or tampered local mirror) could push a 100000 g food entry
    // straight into the journal. Every cached resolution now passes the same
    // sanity gate as model output; failures fall through to the model.
    const cache = memoryCache({
      '2 roti': { intent: 'food', ref: 'dish_roti', qty: 100000, unit: 'g', confidence: 0.99 },
    });
    const transport = transportOf(JSON.stringify({ ...rajma, ref: 'dish_roti', unit: 'roti' }));
    const out = await resolve('2 roti', deps(cache, transport));
    expect(out[0]).toMatchObject({ source: 'model', resolution: { ref: 'dish_roti' } });
    expect(transport.calls).toEqual(['2 roti']);
  });

  it('a cached ref that left the catalogue is not served', async () => {
    const cache = memoryCache({
      '2 roti': { intent: 'food', ref: 'dish_deleted', qty: 2, unit: 'roti', confidence: 0.99 },
    });
    const transport = transportOf(JSON.stringify({ ...rajma, ref: 'dish_roti', unit: 'roti' }));
    const out = await resolve('2 roti', deps(cache, transport));
    expect(out[0]!.resolution.ref).toBe('dish_roti');
    expect(out[0]!.source).toBe('model');
  });
});

describe('resolve — cache key cardinality (security F1)', () => {
  it('does not mirror resolutions for keys longer than 64 chars', async () => {
    // Head-of-distribution phrases are short; long keys are the cache-fill
    // vector. The server enforces the same bound on the global table.
    const longLine = 'rajma with ' + 'a'.repeat(70);
    const cache = memoryCache();
    const out = await resolve(longLine, deps(cache, transportOf(JSON.stringify(rajma))));
    expect(out[0]!.resolution.ref).toBe('dish_rajma'); // still resolves
    expect(cache.puts).toEqual([]); // but never enters the mirror
  });
});

describe('resolve — local rules path', () => {
  it('deterministic lines skip cache and model', async () => {
    const cache = memoryCache();
    const transport = transportOf('{}');
    const out = await resolve('9000 steps', deps(cache, transport));
    expect(out[0]).toMatchObject({
      source: 'rules',
      resolution: { intent: 'steps', qty: 9000 },
    });
    expect(transport.calls).toEqual([]);
    expect(cache.puts).toEqual([]); // rules are already deterministic; caching adds nothing
  });
});

describe('resolve — model path', () => {
  it('classifies, validates, and mirrors into the local cache', async () => {
    const cache = memoryCache();
    const transport = transportOf(JSON.stringify(rajma));
    const out = await resolve('1 katori rajma', deps(cache, transport));
    expect(out[0]).toMatchObject({ source: 'model', resolution: { ref: 'dish_rajma' } });
    expect(transport.calls).toEqual(['1 katori rajma']);
    expect(cache.puts).toHaveLength(1);
    expect(cache.puts[0]!.key).toBe('1 katori rajma');
  });

  it('does not cache unresolved output', async () => {
    const cache = memoryCache();
    const out = await resolve('xyzzy plugh', deps(cache, transportOf('not json')));
    expect(out[0]!.resolution.intent).toBe('unresolved');
    expect(out[0]!.retryable).toBe(false); // malformed output is not a network problem
    expect(cache.puts).toEqual([]);
  });

  it('does not cache when model context disagrees with the text tokens', async () => {
    // "same input, same output forever": a cache hit reconstructs context
    // from text, so a model-only context judgment must not enter the cache.
    const cache = memoryCache();
    const outside = JSON.stringify({ ...rajma, context: 'outside' });
    const out = await resolve('rajma at mota bhai', deps(cache, transportOf(outside)));
    expect(out[0]!.resolution.context).toBe('outside'); // model judgment kept for this entry
    expect(cache.puts).toEqual([]); // but not cached
  });

  it('splits multi-entry model replies into separate segments', async () => {
    const two = JSON.stringify([
      { intent: 'food', ref: 'dish_roti', qty: 2, unit: 'roti', context: 'home', confidence: 0.9 },
      { intent: 'food', ref: 'dish_dal', qty: 1, unit: 'katori', context: 'home', confidence: 0.9 },
    ]);
    const cache = memoryCache();
    const out = await resolve('roti sabzi thali', deps(cache, transportOf(two)));
    expect(out).toHaveLength(2);
    expect(cache.puts).toEqual([]); // multi-resolution lines cannot key a single cache row
  });
});

describe('resolve — conjunction split', () => {
  it('each side of "aur" resolves independently', async () => {
    const cache = memoryCache({
      '2 roti': { intent: 'food', ref: 'dish_roti', qty: 2, unit: 'roti', confidence: 0.99 },
    });
    const dal = JSON.stringify({ ...rajma, ref: 'dish_dal', unit: 'katori' });
    const transport = transportOf(dal);
    const out = await resolve('2 roti aur ek katori dal', deps(cache, transport));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: 'cache', resolution: { ref: 'dish_roti' } });
    expect(out[1]).toMatchObject({ source: 'model', resolution: { ref: 'dish_dal' } });
    expect(transport.calls).toEqual(['1 katori dal']); // normalized segment
  });
});

describe('resolve — failure honesty', () => {
  it('network failure → unresolved, retryable', async () => {
    const transport: ClassifyTransport = {
      classify: () => Promise.reject(new TransportError('network')),
    };
    const out = await resolve('2 roti', { cache: memoryCache(), transport, catalogue });
    expect(out[0]!.resolution.intent).toBe('unresolved');
    expect(out[0]!.retryable).toBe(true);
  });

  it('rate limit → unresolved, retryable', async () => {
    const transport: ClassifyTransport = {
      classify: () => Promise.reject(new TransportError('rate_limit')),
    };
    const out = await resolve('2 roti', { cache: memoryCache(), transport, catalogue });
    expect(out[0]!.retryable).toBe(true);
  });

  it('disabled (kill switch) → unresolved, NOT retryable', async () => {
    const transport: ClassifyTransport = {
      classify: () => Promise.reject(new TransportError('disabled')),
    };
    const out = await resolve('2 roti', { cache: memoryCache(), transport, catalogue });
    expect(out[0]!.resolution.intent).toBe('unresolved');
    expect(out[0]!.retryable).toBe(false); // retrying a disabled resolver just thrashes
  });

  it('timeout → unresolved, retryable (spec/09: >3s)', async () => {
    vi.useFakeTimers();
    try {
      const transport: ClassifyTransport = {
        classify: () => new Promise(() => undefined), // hangs forever
      };
      const pending = resolve('2 roti', {
        cache: memoryCache(),
        transport,
        catalogue,
        timeoutMs: 3000,
      });
      await vi.advanceTimersByTimeAsync(3000);
      const out = await pending;
      expect(out[0]!.resolution.intent).toBe('unresolved');
      expect(out[0]!.retryable).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unexpected transport exception never escapes', async () => {
    const transport: ClassifyTransport = {
      classify: () => Promise.reject(new Error('boom')),
    };
    const out = await resolve('2 roti', { cache: memoryCache(), transport, catalogue });
    expect(out[0]!.resolution.intent).toBe('unresolved');
    expect(out[0]!.retryable).toBe(true);
  });

  it('a non-Error rejection is wrapped, not leaked, and stays unresolved', async () => {
    // A transport that rejects with a bare string still becomes an honest
    // unresolved retry, never an escaping throw.
    const transport: ClassifyTransport = {
      classify: () => Promise.reject('kaput'),
    };
    const out = await resolve('2 roti', { cache: memoryCache(), transport, catalogue });
    expect(out[0]!.resolution.intent).toBe('unresolved');
    expect(out[0]!.retryable).toBe(true);
  });
});
