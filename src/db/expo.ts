// expo-sqlite implementation of SqlAdapter — the only file that imports the
// native module, so everything else (repos, journal core, tests) stays pure.
// Node tests use test/helpers/betterSqliteAdapter.ts against identical SQL.

import * as SQLite from 'expo-sqlite';

import { runTransaction, type SqlAdapter, type SqlValue } from './adapter';
import { migrate } from './schema';

export async function openDatabase(name = 'slate.db'): Promise<SqlAdapter> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL');
  await db.execAsync('PRAGMA foreign_keys = ON');

  const adapter: SqlAdapter = {
    async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
      await db.runAsync(sql, [...params]);
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      return db.getAllAsync<T>(sql, [...params]);
    },
    async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
      return db.getFirstAsync<T>(sql, [...params]);
    },
    async transaction(work: () => Promise<void>): Promise<void> {
      await runTransaction(adapter, work);
    },
  };

  await migrate(adapter);
  return adapter;
}
