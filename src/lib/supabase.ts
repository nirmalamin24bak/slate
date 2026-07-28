import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

import { signinDeferral, track } from './analytics';
import { env } from './env';
import { sessionStore } from './secureSession';

// Supabase is truth; expo-sqlite is the on-device read source (spec/04).
// Region ap-south-1 (Mumbai) — DPDP data residency. Confirmed in the
// dashboard by Nirmal; scripts/check-region.mjs re-checks best-effort.
//
// Auth model (MASTER.md, reversed twice, final): anonymous sign-in at
// install. No login screen exists anywhere. Sign-in is an offer in
// Settings that upgrades the same auth.users row in place.
// The session (refresh token included) goes to the Keychain, not to a plaintext
// file in the app container — see src/lib/secureSession.ts for why that is not a
// nice-to-have here: with no login and no step-up auth, the refresh token is the
// entire identity. The store falls back to AsyncStorage where no Keychain exists
// (web, Expo Go, tests) and migrates any session an older build left behind.
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: sessionStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Called once at app start (wired in Phase 1 alongside the first schema).
// Reuses an existing session; only creates the anonymous user on first run.
export async function ensureAnonymousSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    // Offline install is a specced case (spec/09): onboarding state is held
    // locally and flushed to profiles + kitchen when a session exists.
    // Callers treat "no session yet" as queued work, not a failure screen.
    //
    // The message is classified, not forwarded: a Supabase auth error can carry
    // the project ref or a request id, and analytics is not allowed either.
    track({ name: 'anon_signin_deferred', reason: signinDeferral(error.message) });
  }
}
