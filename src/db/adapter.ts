// The one SQL surface every repo writes against. Two implementations:
// expo-sqlite on device (src/db/expo.ts) and better-sqlite3 in Node tests
// (test/helpers/). Repos stay pure SQL + mapping and run identically on both.

export type SqlValue = string | number | null;

export interface SqlAdapter {
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  /**
   * BEGIN IMMEDIATE … COMMIT/ROLLBACK. Callers never nest transactions —
   * the journal writes are small and the onboarding flush is one shot.
   */
  transaction(work: () => Promise<void>): Promise<void>;
}

/** Shared transaction shape so both adapters behave identically. */
export async function runTransaction(
  adapter: SqlAdapter,
  work: () => Promise<void>,
): Promise<void> {
  await adapter.run('BEGIN IMMEDIATE');
  try {
    await work();
    await adapter.run('COMMIT');
  } catch (error) {
    await adapter.run('ROLLBACK');
    throw error;
  }
}
