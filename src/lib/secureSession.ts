// Where the Supabase session lives on the device.
//
// Audit C5: the session — including the long-lived refresh token — was persisted
// straight to AsyncStorage, which on iOS is an unencrypted file inside the app
// container, not the Keychain. Slate has no login and no step-up auth, so that
// token IS the identity: anything that reads the file (an unencrypted backup, a
// jailbroken device, a forensic extraction) can read the whole journal and can
// call delete-account, which is irreversible and has no recovery path because
// there is no email and no password to restore from.
//
// The session now goes to expo-secure-store (iOS Keychain / Android Keystore).
// Three things this file has to get right, none of them optional:
//
//   1. SIZE. SecureStore warns above 2048 bytes and is not built for large
//      values; a Supabase session with a JWT and a user object routinely exceeds
//      that. Values are split into chunks, with the chunk count under the caller's
//      key and the parts beside it.
//   2. MIGRATION. An existing install already has its session in AsyncStorage. If
//      a read misses in SecureStore we must look there before reporting "no
//      session" — otherwise the upgrade signs the user in as a BRAND NEW
//      anonymous user and their journal is orphaned on the server under an id
//      the device has forgotten. The legacy copy is moved, then deleted.
//   3. ABSENCE. SecureStore is a native module: it does not exist under vitest,
//      on web, or in Expo Go. Same guarded-require shape as revenuecat.ts and
//      analytics.ts — where it is missing we fall back to AsyncStorage, which is
//      exactly the old behaviour and is correct for a browser anyway.

// Nothing is imported at module scope on purpose: both backends are native/RN
// modules, and the chunking and migration logic below is the part with real
// failure modes, so it has to be reachable from a Node test. Both are required
// lazily inside sessionStore().

/** The supabase-js `auth.storage` contract. */
export interface SessionStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * The slice of expo-secure-store this file uses. Declared rather than imported
 * so the module stays type-checked where the native package cannot load.
 */
export interface SecureBackend {
  getItemAsync(key: string, options?: Record<string, unknown>): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>;
  deleteItemAsync(key: string, options?: Record<string, unknown>): Promise<void>;
}

/**
 * Comfortably under SecureStore's 2048-byte guidance. Chunks are counted in
 * UTF-16 code units, not bytes, so the margin absorbs multi-byte characters —
 * a session is base64url JWT plus JSON, so in practice it is all ASCII anyway.
 */
export const CHUNK_SIZE = 1536;

/** Keychain items must survive a locked device: the SDK refreshes tokens in the background. */
const KEYCHAIN_OPTIONS = { keychainAccessible: 'AFTER_FIRST_UNLOCK' } as const;

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

function split(value: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    parts.push(value.slice(i, i + CHUNK_SIZE));
  }
  // An empty string is one empty chunk, not zero chunks — otherwise writing ''
  // and reading it back would produce null, which supabase-js reads as "signed out".
  return parts.length > 0 ? parts : [''];
}

/**
 * A SessionStore over a secure backend, with chunking and a one-time move of any
 * value left behind in AsyncStorage by an older build.
 *
 * `legacy` is injectable so the migration path is testable without the native
 * module; production passes AsyncStorage.
 */
export function chunkedSecureStore(secure: SecureBackend, legacy: SessionStore): SessionStore {
  async function readCount(key: string): Promise<number | null> {
    const head = await secure.getItemAsync(key, KEYCHAIN_OPTIONS);
    if (head === null) return null;
    const count = Number.parseInt(head, 10);
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  async function clear(key: string): Promise<void> {
    const count = await readCount(key);
    if (count !== null) {
      for (let i = 0; i < count; i++) {
        await secure.deleteItemAsync(chunkKey(key, i), KEYCHAIN_OPTIONS);
      }
    }
    await secure.deleteItemAsync(key, KEYCHAIN_OPTIONS);
  }

  async function write(key: string, value: string): Promise<void> {
    // Drop the previous value first: a shorter session would otherwise leave
    // orphaned trailing chunks that a later, longer write would read back as
    // part of its own value.
    await clear(key);
    const parts = split(value);
    for (let i = 0; i < parts.length; i++) {
      await secure.setItemAsync(chunkKey(key, i), parts[i] as string, KEYCHAIN_OPTIONS);
    }
    // The count is written LAST, so an interrupted write leaves no head and the
    // next read reports "no session" rather than reassembling a partial one.
    await secure.setItemAsync(key, String(parts.length), KEYCHAIN_OPTIONS);
  }

  return {
    async getItem(key) {
      const count = await readCount(key);
      if (count !== null) {
        const parts: string[] = [];
        for (let i = 0; i < count; i++) {
          const part = await secure.getItemAsync(chunkKey(key, i), KEYCHAIN_OPTIONS);
          // A missing chunk means a torn write or a partially-evicted Keychain.
          // Report no session rather than a corrupt one: the user re-signs in
          // anonymously, which is recoverable; a malformed token is not.
          if (part === null) return null;
          parts.push(part);
        }
        return parts.join('');
      }

      // Miss. Before concluding "signed out", look for a session an older build
      // left in AsyncStorage and move it across. This runs once per install.
      const inherited = await legacy.getItem(key);
      if (inherited === null) return null;
      await write(key, inherited);
      await legacy.removeItem(key);
      return inherited;
    },

    async setItem(key, value) {
      await write(key, value);
    },

    async removeItem(key) {
      await clear(key);
      // Also clear any legacy copy, so a sign-out cannot be undone by the
      // migration path resurrecting the old token on the next read.
      await legacy.removeItem(key);
    },
  };
}

/**
 * Load expo-secure-store if the native module is present. Absent under vitest,
 * on web, and in Expo Go.
 */
function loadSecureBackend(): SecureBackend | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-secure-store') as Partial<SecureBackend>;
    if (typeof mod?.getItemAsync !== 'function') return null;
    return mod as SecureBackend;
  } catch {
    return null;
  }
}

function loadAsyncStorage(): SessionStore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-async-storage/async-storage') as {
    default: SessionStore;
  };
  return mod.default;
}

/**
 * The store handed to supabase-js. Secure where a Keychain exists; AsyncStorage
 * where one does not, which is the same behaviour as before this change.
 */
export function sessionStore(): SessionStore {
  const legacy = loadAsyncStorage();
  const secure = loadSecureBackend();
  if (!secure) return legacy;
  return chunkedSecureStore(secure, legacy);
}
