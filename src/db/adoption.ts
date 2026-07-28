// Placeholder-user adoption (spec/09 offline install). Pure SQL, so it lives
// in the db layer and tests without the native supabase client. When the
// anonymous session finally arrives, every locally-owned row is re-homed from
// the placeholder id to the real uid and re-marked dirty so it pushes.

import { runTransaction, type SqlAdapter } from './adapter';

/**
 * Rows written before a session existed are owned by this id. It is a
 * singleton key, never a valid auth.uid(); pushDirty must never send its rows.
 */
export const PENDING_USER_ID = 'pending-anon';

const OWNED_TABLES = ['entries', 'weights', 'profiles', 'kitchen'] as const;

export async function adoptPendingUser(adapter: SqlAdapter, userId: string): Promise<void> {
  // All-or-nothing: a crash mid-loop must not adopt entries while leaving
  // weights or kitchen under the placeholder id (which pushDirty then skips,
  // orphaning them until a re-adoption).
  await runTransaction(adapter, async () => {
    for (const table of OWNED_TABLES) {
      // table is a compile-time literal; userId is bound.
      await adapter.run(`UPDATE ${table} SET user_id = ?, dirty = 1 WHERE user_id = ?`, [
        userId,
        PENDING_USER_ID,
      ]);
    }
  });
}
