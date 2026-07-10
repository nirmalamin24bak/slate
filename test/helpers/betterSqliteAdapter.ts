// Node-side SqlAdapter over better-sqlite3, for tests only. Same SQL dialect
// as expo-sqlite (both are SQLite), so repos tested here run unchanged on
// device. In-memory by default; pass a path to simulate force-quit/reopen.

import Database from 'better-sqlite3';

import type { SqlAdapter, SqlValue } from '@/db/adapter';
import { migrate } from '@/db/schema';

export async function openTestDb(file = ':memory:'): Promise<SqlAdapter & { close(): void }> {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');

  const adapter: SqlAdapter & { close(): void } = {
    async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
      if (sql.startsWith('PRAGMA')) {
        db.pragma(sql.slice('PRAGMA '.length));
        return;
      }
      db.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
      if (sql.startsWith('PRAGMA')) {
        const name = sql.slice('PRAGMA '.length);
        const value = db.pragma(name, { simple: true });
        return { [name]: value } as T;
      }
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async transaction(work: () => Promise<void>): Promise<void> {
      // better-sqlite3's native transactions are sync-only; BEGIN/COMMIT via
      // run() keeps semantics identical to the device adapter.
      await adapter.run('BEGIN IMMEDIATE');
      try {
        await work();
        await adapter.run('COMMIT');
      } catch (error) {
        await adapter.run('ROLLBACK');
        throw error;
      }
    },
    close(): void {
      db.close();
    },
  };

  await migrate(adapter);
  return adapter;
}
