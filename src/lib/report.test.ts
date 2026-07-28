// Audit C8. The assertions that matter here are negative ones.
//
// An unfiltered Sentry event carries more of the journal than any analytics
// event would: a default React Native install records a breadcrumb for every
// fetch and every console call, and keeps the request body of failed HTTP calls.
// The resolver POSTs the user's line to an Edge Function. So the breadcrumb
// trail and the request body of a failed classify ARE the journal, and the test
// that matters is that none of it survives scrubEvent.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureReporting,
  reportError,
  scrubEvent,
  __resetForTest,
  __setClientForTest,
  __setSdkLoaderForTest,
  type SentryClient,
  type SentryEvent,
} from './report';

afterEach(() => {
  __resetForTest();
  delete process.env['EXPO_PUBLIC_SENTRY_DSN'];
});

/** An event shaped the way the SDK would build one after a failed classify. */
function pollutedEvent(): SentryEvent {
  return {
    request: {
      url: 'https://ruynujwntbcgznoiwugl.supabase.co/functions/v1/resolver-classify',
      data: JSON.stringify({ line: '2 roti aur ek katori dal' }),
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret' },
    },
    breadcrumbs: [
      { category: 'fetch', data: { body: '{"line":"chicken biryani 1 plate"}' } },
      { category: 'console', message: 'resolved 2 roti -> dish_roti' },
    ],
    extra: { entryId: 'e-123', raw_text: 'mummy ke haath ka dal' },
    contexts: { device: { name: "Nirmal's iPhone" } },
    user: { id: 'uid', ip_address: '49.36.0.1' },
    message: 'sync push entries: duplicate key value violates ...',
  };
}

describe('scrubEvent', () => {
  it('drops every field that could carry journal content', () => {
    const scrubbed = scrubEvent(pollutedEvent());

    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.contexts).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.message).toBeUndefined();
  });

  it('leaves nothing recognisable from the journal anywhere in the payload', () => {
    // The assertion that would catch a field we forgot to think about: serialise
    // the whole scrubbed event and look for the things that must never appear.
    const serialised = JSON.stringify(scrubEvent(pollutedEvent()));

    for (const secret of [
      'roti',
      'biryani',
      'dal',
      'e-123',
      'iPhone',
      '49.36.0.1',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'ruynujwntbcgznoiwugl', // the project ref, which analytics.ts also refuses
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('survives an event that is already empty', () => {
    expect(() => scrubEvent({})).not.toThrow();
  });
});

describe('configureReporting', () => {
  function fakeSdk() {
    const init = vi.fn();
    const captureException = vi.fn();
    const sdk: SentryClient = { init, captureException };
    return { sdk, init, captureException };
  }

  it('stays inert when no DSN is set', () => {
    const { sdk, init } = fakeSdk();
    __setSdkLoaderForTest(() => sdk);
    configureReporting();
    expect(init).not.toHaveBeenCalled();
  });

  it('stays inert when the native module is absent', () => {
    process.env['EXPO_PUBLIC_SENTRY_DSN'] = 'https://k@o.ingest.sentry.io/1';
    __setSdkLoaderForTest(() => null);
    expect(() => configureReporting()).not.toThrow();
    // and reporting through it is still a no-op, not a crash
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });

  it('initialises with the options that ARE the guarantee', () => {
    process.env['EXPO_PUBLIC_SENTRY_DSN'] = 'https://k@o.ingest.sentry.io/1';
    const { sdk, init } = fakeSdk();
    __setSdkLoaderForTest(() => sdk);

    configureReporting();

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0]?.[0] as Record<string, unknown>;
    // Each of these, if flipped, ships journal content to a vendor.
    expect(options['sendDefaultPii']).toBe(false);
    expect(options['maxBreadcrumbs']).toBe(0);
    expect(options['tracesSampleRate']).toBe(0);
    expect(options['enableAutoSessionTracking']).toBe(false);
    expect(typeof options['beforeSend']).toBe('function');
    // A breadcrumb that is never recorded cannot be sent.
    expect((options['beforeBreadcrumb'] as () => unknown)()).toBeNull();
  });

  it('wires beforeSend to the scrubber, not to something that merely exists', () => {
    process.env['EXPO_PUBLIC_SENTRY_DSN'] = 'https://k@o.ingest.sentry.io/1';
    const { sdk, init } = fakeSdk();
    __setSdkLoaderForTest(() => sdk);
    configureReporting();

    const options = init.mock.calls[0]?.[0] as Record<string, unknown>;
    const beforeSend = options['beforeSend'] as (e: SentryEvent) => SentryEvent;
    const out = JSON.stringify(beforeSend(pollutedEvent()));

    expect(out).not.toContain('roti');
    expect(out).not.toContain('49.36.0.1');
  });

  it('configures once, however many times it is called', () => {
    process.env['EXPO_PUBLIC_SENTRY_DSN'] = 'https://k@o.ingest.sentry.io/1';
    const { sdk, init } = fakeSdk();
    __setSdkLoaderForTest(() => sdk);

    configureReporting();
    configureReporting();
    configureReporting();

    expect(init).toHaveBeenCalledTimes(1);
  });
});

describe('reportError', () => {
  it('sends the error with context as tags, and no free-form payload', () => {
    const captureException = vi.fn();
    __setClientForTest({ init: vi.fn(), captureException });

    const error = new Error('sync failed');
    reportError(error, { op: 'syncTick', screen: 'journal' });

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { screen: 'journal', op: 'syncTick', boundary: undefined },
    });
    // `extra` is where a call site would put "the row that failed" — the field
    // scrubEvent drops. It must not be produced in the first place.
    const hint = captureException.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(hint['extra']).toBeUndefined();
  });

  it('is a no-op, not a throw, when reporting is off', () => {
    __setClientForTest(null);
    expect(() => reportError(new Error('boom'), { op: 'x' })).not.toThrow();
  });

  it('swallows an SDK that throws, because reporting must never break the app', () => {
    __setClientForTest({
      init: vi.fn(),
      captureException: () => {
        throw new Error('sentry is having a day');
      },
    });
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });
});
