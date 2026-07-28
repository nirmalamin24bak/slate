import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  configureAnalytics,
  confidenceBucket,
  flushAnalytics,
  MAX_PENDING_EVENTS,
  screenOf,
  signinDeferral,
  stopAnalytics,
  track,
  __pendingCountForTest,
  __resetForTest,
  __setClientForTest,
  __setSdkLoaderForTest,
} from './analytics';

// This file guards a compliance boundary, not a feature. The assertions that
// matter most are the negative ones: what does NOT go into a payload, and which
// SDK options are set. spec/08 and docs/analytics-handoff.md are the source.

interface Captured {
  event: string;
  properties?: Record<string, unknown>;
}

function fakeClient() {
  const captured: Captured[] = [];
  const identified: { id: string; properties?: Record<string, unknown> }[] = [];
  let optedOut = false;
  let flushes = 0;
  return {
    captured,
    identified,
    get optedOut() {
      return optedOut;
    },
    get flushes() {
      return flushes;
    },
    capture(event: string, properties?: Record<string, unknown>) {
      captured.push({ event, properties });
    },
    identify(id: string, properties?: Record<string, unknown>) {
      identified.push({ id, properties });
    },
    optOut() {
      optedOut = true;
    },
    flush() {
      flushes++;
    },
  };
}

const KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST;

beforeEach(() => {
  __resetForTest();
});

afterEach(() => {
  __resetForTest();
  if (KEY === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  else process.env.EXPO_PUBLIC_POSTHOG_API_KEY = KEY;
  if (HOST === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
  else process.env.EXPO_PUBLIC_POSTHOG_HOST = HOST;
});

function withKeys(): void {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'phc_test';
  process.env.EXPO_PUBLIC_POSTHOG_HOST = 'https://ph.slate.internal';
}

function withoutKeys(): void {
  delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
}

describe('configureAnalytics', () => {
  it('passes the pinned host and disables replay and lifecycle capture', () => {
    withKeys();
    const client = fakeClient();
    const options: Record<string, unknown>[] = [];
    const keys: string[] = [];
    __setSdkLoaderForTest(() => ({
      PostHog: class {
        constructor(apiKey: string, opts: Record<string, unknown>) {
          keys.push(apiKey);
          options.push(opts);
        }
        capture = client.capture;
        identify = client.identify;
        optOut = client.optOut;
        flush = client.flush;
      },
    }));

    configureAnalytics('uid-1');

    expect(keys).toEqual(['phc_test']);
    // Residency: the host is ours, in ap-south-1. A default host would be
    // PostHog US Cloud, which is the failure docs/analytics-handoff.md exists
    // to prevent.
    expect(options[0]?.host).toBe('https://ph.slate.internal');
    // Session replay would record the journal being typed.
    expect(options[0]?.enableSessionReplay).toBe(false);
    expect(options[0]?.captureNativeAppLifecycleEvents).toBe(false);
    expect(options[0]?.disableGeoip).toBe(true);
  });

  it('identifies auth.uid() with no traits at all', () => {
    withKeys();
    const client = fakeClient();
    __setSdkLoaderForTest(() => ({
      PostHog: function (this: unknown) {
        return client;
      } as never,
    }));

    configureAnalytics('uid-2');

    expect(client.identified).toEqual([{ id: 'uid-2', properties: undefined }]);
  });

  it('is inert when the key is absent, and drops what queued', () => {
    withoutKeys();
    track({ name: 'export_run' });
    expect(__pendingCountForTest()).toBe(1);

    configureAnalytics('uid-3');

    expect(__pendingCountForTest()).toBe(0);
    // And nothing queues afterwards either — there is nothing to flush into.
    track({ name: 'delete_run' });
    expect(__pendingCountForTest()).toBe(0);
  });

  it('is inert when the SDK is not installed', () => {
    withKeys();
    __setSdkLoaderForTest(() => null);
    configureAnalytics('uid-4');
    track({ name: 'export_run' });
    expect(__pendingCountForTest()).toBe(0);
  });

  it('survives a constructor that throws', () => {
    withKeys();
    __setSdkLoaderForTest(() => ({
      PostHog: class {
        constructor() {
          throw new Error('bad host');
        }
      } as never,
    }));
    expect(() => configureAnalytics('uid-5')).not.toThrow();
    expect(() => track({ name: 'export_run' })).not.toThrow();
  });

  it('configures once, however many times it is called', () => {
    withKeys();
    const client = fakeClient();
    let constructions = 0;
    __setSdkLoaderForTest(() => ({
      PostHog: function (this: unknown) {
        constructions++;
        return client;
      } as never,
    }));
    configureAnalytics('uid-6');
    configureAnalytics('uid-6');
    configureAnalytics('uid-7');
    expect(constructions).toBe(1);
    expect(client.identified).toHaveLength(1);
  });

  it('propagates the half-configured throw from env (wrong-region guard)', () => {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'phc_test';
    delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
    expect(() => configureAnalytics('uid-8')).toThrow(/half-configured/);
  });
});

describe('track', () => {
  it('sends the event name and the properties, with no name inside them', () => {
    const client = fakeClient();
    __setClientForTest(client);

    track({
      name: 'entry_resolved',
      intent: 'food',
      ref: 'dish_dal_toor',
      confidence_bucket: 'high',
      resolve_ms: 42,
      source: 'cache',
    });

    expect(client.captured).toEqual([
      {
        event: 'entry_resolved',
        properties: {
          intent: 'food',
          ref: 'dish_dal_toor',
          confidence_bucket: 'high',
          resolve_ms: 42,
          source: 'cache',
        },
      },
    ]);
    expect(client.captured[0]?.properties).not.toHaveProperty('name');
  });

  it('sends undefined properties for a bare event', () => {
    const client = fakeClient();
    __setClientForTest(client);
    track({ name: 'delete_run' });
    expect(client.captured).toEqual([{ event: 'delete_run', properties: undefined }]);
  });

  it('never lets a failing capture reach the caller', () => {
    __setClientForTest({
      capture() {
        throw new Error('network');
      },
      identify() {},
      optOut() {},
      flush() {},
    });
    expect(() => track({ name: 'export_run' })).not.toThrow();
  });

  it('queues before configure and flushes in order once configured', () => {
    withKeys();
    const client = fakeClient();
    __setSdkLoaderForTest(() => ({
      PostHog: function (this: unknown) {
        return client;
      } as never,
    }));

    track({ name: 'screen_viewed', screen: 'journal' });
    track({ name: 'anon_signin_deferred', reason: 'offline' });
    expect(__pendingCountForTest()).toBe(2);

    configureAnalytics('uid-9');

    expect(client.captured.map((c) => c.event)).toEqual(['screen_viewed', 'anon_signin_deferred']);
    expect(__pendingCountForTest()).toBe(0);
  });

  it('bounds the pre-configure queue', () => {
    for (let i = 0; i < MAX_PENDING_EVENTS + 25; i++) {
      track({ name: 'screen_viewed', screen: 'journal' });
    }
    expect(__pendingCountForTest()).toBe(MAX_PENDING_EVENTS);
  });
});

describe('stopAnalytics', () => {
  it('opts out and sends nothing more', () => {
    const client = fakeClient();
    __setClientForTest(client);
    track({ name: 'delete_run' });

    stopAnalytics();

    expect(client.optedOut).toBe(true);
    track({ name: 'export_run' });
    expect(client.captured.map((c) => c.event)).toEqual(['delete_run']);
    // Nor does it start queueing again for a user who has left.
    expect(__pendingCountForTest()).toBe(0);
  });

  it('is safe with no client', () => {
    expect(() => stopAnalytics()).not.toThrow();
  });

  it('survives an SDK that throws on optOut', () => {
    __setClientForTest({
      capture() {},
      identify() {},
      optOut() {
        throw new Error('already gone');
      },
      flush() {},
    });
    expect(() => stopAnalytics()).not.toThrow();
  });
});

describe('flushAnalytics', () => {
  it('flushes through to the SDK', async () => {
    const client = fakeClient();
    __setClientForTest(client);
    await flushAnalytics();
    expect(client.flushes).toBe(1);
  });

  it('is a no-op with no client', async () => {
    await expect(flushAnalytics()).resolves.toBeUndefined();
  });

  it('swallows a rejected flush (offline)', async () => {
    __setClientForTest({
      capture() {},
      identify() {},
      optOut() {},
      flush() {
        return Promise.reject(new Error('offline'));
      },
    });
    await expect(flushAnalytics()).resolves.toBeUndefined();
  });
});

describe('screenOf', () => {
  it.each([
    ['/', 'journal'],
    ['', 'journal'],
    ['/index', 'journal'],
    ['/history', 'history'],
    ['/stats', 'stats'],
    ['/streak', 'streak'],
    ['/paywall', 'paywall'],
    ['/scanner', 'scanner'],
    ['/chat', 'chat'],
    ['/onboarding', 'onboarding'],
    ['/settings', 'settings'],
    ['/settings/display', 'settings'],
    ['/settings/saved-foods', 'settings'],
  ])('%s maps to %s', (path, expected) => {
    expect(screenOf(path)).toBe(expected);
  });

  it('strips a query string rather than sending it', () => {
    // A query param is free text. `/paywall?gate=x` must never be an event value.
    expect(screenOf('/paywall?gate=history_depth')).toBe('paywall');
  });

  it('ignores a trailing slash', () => {
    expect(screenOf('/history/')).toBe('history');
  });

  it('returns null for an unknown route instead of the raw path', () => {
    expect(screenOf('/some-future-screen')).toBeNull();
    expect(screenOf('/history/2026-07-28')).toBeNull();
  });
});

describe('confidenceBucket', () => {
  it.each([
    [1, 'high'],
    [0.85, 'high'],
    [0.849, 'medium'],
    [0.6, 'medium'],
    [0.599, 'low'],
    [0, 'low'],
  ])('%s is %s', (value, expected) => {
    expect(confidenceBucket(value)).toBe(expected);
  });
});

describe('signinDeferral', () => {
  it.each([
    ['Network request failed', 'offline'],
    ['fetch failed', 'offline'],
    ['Request timeout', 'offline'],
    ['Too many requests', 'rate_limited'],
    ['429: rate limit exceeded', 'rate_limited'],
    ['Anonymous sign-ins are disabled', 'rejected'],
    ['Unauthorized', 'rejected'],
    ['something nobody predicted', 'unknown'],
  ])('%s is %s', (message, expected) => {
    expect(signinDeferral(message)).toBe(expected);
  });

  it('never returns the message itself', () => {
    // The whole point: a Supabase error can carry the project ref or a request
    // id, and neither is allowed into an event payload.
    const message = 'project ruynujwntbcgznoiwugl rejected request 8f2a-c19d';
    expect(signinDeferral(message)).toBe('rejected');
    const client = fakeClient();
    __setClientForTest(client);
    track({ name: 'anon_signin_deferred', reason: signinDeferral(message) });
    expect(JSON.stringify(client.captured)).not.toContain('ruynujwntbcgznoiwugl');
  });
});

describe('the boundary itself', () => {
  it('exports no free-form capture', async () => {
    // docs/analytics-handoff.md: "If a call site can pass an arbitrary string,
    // the boundary has failed." This asserts the shape of the module, because
    // the rule is about the shape.
    const module: Record<string, unknown> = await import('./analytics');
    expect(module.capture).toBeUndefined();
    expect(module.posthog).toBeUndefined();
    expect(typeof module.track).toBe('function');
    expect(module.track).toHaveLength(1); // one argument: the event object
  });

  it('has no other importer of the PostHog SDK', async () => {
    const { readFileSync } = await import('node:fs');
    const { execSync } = await import('node:child_process');
    const files = execSync('git ls-files "src/**/*.ts" "src/**/*.tsx" "app/**/*.tsx"', {
      encoding: 'utf8',
    })
      .split('\n')
      .filter((f) => f && f !== 'src/lib/analytics.ts' && f !== 'src/lib/analytics.test.ts');
    // An actual import of the package, not the word "PostHog" in a comment or
    // in the EXPO_PUBLIC_POSTHOG_* variable names.
    const importsSdk = /(?:from|require\()\s*['"]posthog-react-native/;
    const offenders = files.filter((f) => importsSdk.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
