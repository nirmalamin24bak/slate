// Audit C5. The value being moved is the refresh token, and with no login there
// is no way to recover from getting this wrong: a lost session orphans the
// user's journal under a server id the device has forgotten, and a corrupt one
// is worse than no session at all. So the assertions that matter here are the
// failure modes — torn writes, shrinking values, a miss that must consult the
// old location before reporting "signed out".

import { describe, expect, it } from 'vitest';

import {
  chunkedSecureStore,
  CHUNK_SIZE,
  type SecureBackend,
  type SessionStore,
} from './secureSession';

/** In-memory SecureStore whose contents the tests can inspect and corrupt. */
function fakeSecure(): SecureBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItemAsync: (key) => Promise.resolve(map.get(key) ?? null),
    setItemAsync: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

function fakeLegacy(
  seed: Record<string, string> = {},
): SessionStore & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (key) => Promise.resolve(map.get(key) ?? null),
    setItem: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

const KEY = 'sb-ruynujwntbcgznoiwugl-auth-token';

/** Roughly the shape and size of a real Supabase session: comfortably chunked. */
const SESSION = JSON.stringify({
  access_token: 'a'.repeat(900),
  refresh_token: 'r'.repeat(64),
  expires_at: 1_800_000_000,
  user: { id: '0193f0d4-1f9a-7c2e-9f6b-2a1c4d5e6f70', is_anonymous: true, meta: 'm'.repeat(900) },
});

describe('chunkedSecureStore', () => {
  it('round-trips a value larger than one chunk', async () => {
    const store = chunkedSecureStore(fakeSecure(), fakeLegacy());
    await store.setItem(KEY, SESSION);
    expect(await store.getItem(KEY)).toBe(SESSION);
  });

  it('actually splits — no single stored item exceeds the chunk size', async () => {
    const secure = fakeSecure();
    const store = chunkedSecureStore(secure, fakeLegacy());
    await store.setItem(KEY, SESSION);

    expect(SESSION.length).toBeGreaterThan(CHUNK_SIZE); // the test is meaningful
    for (const value of secure.map.values()) {
      expect(value.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it('round-trips a value smaller than one chunk', async () => {
    const store = chunkedSecureStore(fakeSecure(), fakeLegacy());
    await store.setItem(KEY, 'small');
    expect(await store.getItem(KEY)).toBe('small');
  });

  it('round-trips an empty string as an empty string, not as null', async () => {
    // supabase-js reads null as "signed out"; '' must not become that.
    const store = chunkedSecureStore(fakeSecure(), fakeLegacy());
    await store.setItem(KEY, '');
    expect(await store.getItem(KEY)).toBe('');
  });

  it('returns null for a key that was never written', async () => {
    const store = chunkedSecureStore(fakeSecure(), fakeLegacy());
    expect(await store.getItem(KEY)).toBeNull();
  });

  it('leaves no orphaned chunks when a long value is replaced by a short one', async () => {
    const secure = fakeSecure();
    const store = chunkedSecureStore(secure, fakeLegacy());
    await store.setItem(KEY, SESSION);
    await store.setItem(KEY, 'short');

    expect(await store.getItem(KEY)).toBe('short');
    // head + exactly one chunk; a stale tail would have been re-read as part of
    // the next longer value.
    expect(secure.map.size).toBe(2);
  });

  it('removes every chunk on removeItem', async () => {
    const secure = fakeSecure();
    const store = chunkedSecureStore(secure, fakeLegacy());
    await store.setItem(KEY, SESSION);
    await store.removeItem(KEY);

    expect(secure.map.size).toBe(0);
    expect(await store.getItem(KEY)).toBeNull();
  });

  it('reports no session when a chunk is missing, rather than a truncated one', async () => {
    const secure = fakeSecure();
    const store = chunkedSecureStore(secure, fakeLegacy());
    await store.setItem(KEY, SESSION);
    secure.map.delete(`${KEY}.1`); // torn write / partially evicted Keychain

    expect(await store.getItem(KEY)).toBeNull();
  });

  it('reports no session when the head is not a count', async () => {
    const secure = fakeSecure();
    const store = chunkedSecureStore(secure, fakeLegacy());
    secure.map.set(KEY, 'not-a-number');

    expect(await store.getItem(KEY)).toBeNull();
  });
});

describe('chunkedSecureStore migration from AsyncStorage', () => {
  it('adopts a session left behind by an older build', async () => {
    // The regression this guards: without it, upgrading signs the user in as a
    // brand new anonymous user and their journal is orphaned on the server.
    const legacy = fakeLegacy({ [KEY]: SESSION });
    const store = chunkedSecureStore(fakeSecure(), legacy);

    expect(await store.getItem(KEY)).toBe(SESSION);
  });

  it('moves the adopted session into the secure store and deletes the plaintext copy', async () => {
    const secure = fakeSecure();
    const legacy = fakeLegacy({ [KEY]: SESSION });
    const store = chunkedSecureStore(secure, legacy);

    await store.getItem(KEY);

    expect(legacy.map.has(KEY)).toBe(false); // the whole point: no plaintext left
    expect(secure.map.size).toBeGreaterThan(1);
    expect(await store.getItem(KEY)).toBe(SESSION); // served from secure now
  });

  it('does not consult the legacy store once a secure value exists', async () => {
    const legacy = fakeLegacy({ [KEY]: 'stale-session' });
    const store = chunkedSecureStore(fakeSecure(), legacy);
    await store.setItem(KEY, SESSION);

    expect(await store.getItem(KEY)).toBe(SESSION);
  });

  it('does not resurrect a legacy session after sign-out', async () => {
    const legacy = fakeLegacy({ [KEY]: SESSION });
    const store = chunkedSecureStore(fakeSecure(), legacy);

    await store.removeItem(KEY);

    expect(await store.getItem(KEY)).toBeNull();
    expect(legacy.map.has(KEY)).toBe(false);
  });
});
