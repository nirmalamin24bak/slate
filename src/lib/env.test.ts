import { afterEach, describe, expect, it } from 'vitest';

import { env } from './env';

// The one env rule with teeth: PostHog must be fully configured or off. A key
// without a host would ship analytics to the wrong region (off-shore).

describe('env.postHog', () => {
  const key = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;
  afterEach(() => {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = key;
    process.env.EXPO_PUBLIC_POSTHOG_HOST = host;
  });

  it('null when neither is set (analytics off)', () => {
    delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
    delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
    expect(env.postHog).toBeNull();
  });

  it('returns both when both are set', () => {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'phc_x';
    process.env.EXPO_PUBLIC_POSTHOG_HOST = 'https://ph.example.in';
    expect(env.postHog).toEqual({ key: 'phc_x', host: 'https://ph.example.in' });
  });

  it('throws when a key has no host (would leak off-region)', () => {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'phc_x';
    delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
    expect(() => env.postHog).toThrow(/half-configured/);
  });
});
