import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { env } from './env';
import { reportEvent } from './report';

// Supabase is truth; expo-sqlite is the on-device read source (spec/04).
// Region ap-south-1 (Mumbai) — DPDP data residency. Confirmed in the
// dashboard by Nirmal; scripts/check-region.mjs re-checks best-effort.
//
// Auth model (MASTER.md, reversed twice, final): anonymous sign-in at
// install. No login screen exists anywhere. Sign-in is an offer in
// Settings that upgrades the same auth.users row in place.
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
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
    reportEvent('anon_signin_deferred', { message: error.message });
  }
}
