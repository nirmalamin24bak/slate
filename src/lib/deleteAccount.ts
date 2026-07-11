// Delete my data (spec/08 §2), device side. Two halves:
//   1. server: the delete-account Edge Function hard-deletes auth.users, which
//      cascades to every user table in Supabase.
//   2. local: wipe the SQLite mirror and the AsyncStorage draft/flags so the
//      device holds nothing after erasure. A fresh anonymous session is a new
//      person; the old rows must not survive locally.
//
// Order matters: server first. If the network delete fails we surface it and
// leave local data intact, rather than wipe the device while the truth copy
// lives on.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { runTransaction, type SqlAdapter } from '../db/adapter';
import { supabase } from './supabase';

// User tables mirrored locally (spec/04). Reference mirrors and
// resolution_cache carry no user_id and are left — they're shared, not
// personal. custom_dishes/custom_dish_ingredients are listed so the wipe stays
// correct once Phase 5 syncs them locally (the server cascade already covers
// them); a DELETE against a table the mirror doesn't have yet is a harmless
// no-op via IF-absent guard below.
const USER_TABLES = [
  'entries',
  'weights',
  'profiles',
  'kitchen',
  'custom_dishes',
  'custom_dish_ingredients',
] as const;

// Slate's AsyncStorage keys (onboarding draft/flag, theme). Delete removes the
// user's own state; the theme preference is harmless but goes too for a clean
// slate.
const LOCAL_KEYS = [
  'slate.onboarding.draft.v1',
  'slate.onboarding.done.v1',
  'slate.themeMode.v1',
] as const;

export class DeleteFailed extends Error {}

/**
 * @param adapter live SQLite adapter (from services())
 * Throws DeleteFailed if the server delete does not confirm; local data is
 * then left untouched.
 */
export async function deleteAccount(adapter: SqlAdapter): Promise<void> {
  // confirm:true is required server-side so a bare replayed POST cannot wipe an
  // account (the delete-account function rejects a missing flag).
  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: { confirm: true },
  });
  if (error || !(data as { deleted?: boolean } | null)?.deleted) {
    throw new DeleteFailed('server delete did not confirm');
  }

  // Local wipe is one transaction: a crash mid-loop must not leave the device
  // holding some erased-user rows under the next (new-person) session.
  await runTransaction(adapter, async () => {
    for (const table of USER_TABLES) {
      const exists = await adapter.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [table],
      );
      if (exists) await adapter.run(`DELETE FROM ${table}`);
    }
  });
  await AsyncStorage.multiRemove([...LOCAL_KEYS]);
  await supabase.auth.signOut();
}
