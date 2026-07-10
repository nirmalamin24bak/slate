import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';

// Phase-1 gate: prove user A cannot read user B (spec/04 RLS). This test runs
// against the real Supabase project — anonymous sign-in is the production auth
// path, so two anonymous users are exactly the production threat model.
//
// BLOCKED until Nirmal pastes keys into .env: it fails loudly rather than
// passing silently, because a green RLS gate that never ran is a lie.

function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env yet — handled below
  }
  return out;
}

const dotenv = loadDotEnv();
const url = process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? dotenv['EXPO_PUBLIC_SUPABASE_URL'];
const anonKey =
  process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] ?? dotenv['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
const hasKeys = Boolean(url && anonKey);

// Opt-in: `RLS_TEST=1 npm test` once keys exist and the migration is applied.
// Kept out of the default run so `npm test` stays offline-safe (airplane rule).
const enabled = process.env['RLS_TEST'] === '1';

describe.runIf(enabled)('gate: RLS cross-user denial', () => {
  beforeAll(() => {
    if (!hasKeys) {
      throw new Error(
        'RLS_TEST=1 but no Supabase keys found. Copy .env.example to .env and paste the anon key.',
      );
    }
  });

  test('user A cannot read user B entries; cannot write as user B', async () => {
    if (!url || !anonKey) throw new Error('unreachable: keys checked in beforeAll');

    const clientA = createClient(url, anonKey, { auth: { persistSession: false } });
    const clientB = createClient(url, anonKey, { auth: { persistSession: false } });

    const a = await clientA.auth.signInAnonymously();
    const b = await clientB.auth.signInAnonymously();
    const userA = a.data.user?.id;
    const userB = b.data.user?.id;
    if (!userA || !userB)
      throw new Error(
        `anonymous sign-in failed: ${a.error?.message ?? b.error?.message ?? 'no user'}`,
      );

    // A writes one entry
    const inserted = await clientA.from('entries').insert({
      user_id: userA,
      log_date: '2026-07-10',
      position: 0,
      raw_text: 'rls probe — 2 roti',
      intent: 'food',
      status: 'resolved',
      calc_version: 'engine-v1',
    });
    expect(inserted.error).toBeNull();

    // B cannot see it — RLS filters, so the read "succeeds" with zero rows
    const crossRead = await clientB.from('entries').select('*').eq('user_id', userA);
    expect(crossRead.error).toBeNull();
    expect(crossRead.data).toEqual([]);

    // B cannot forge a row carrying A's user_id — with check rejects it
    const forged = await clientB.from('entries').insert({
      user_id: userA,
      log_date: '2026-07-10',
      position: 1,
      raw_text: 'forged row',
      intent: 'food',
      status: 'resolved',
      calc_version: 'engine-v1',
    });
    expect(forged.error).not.toBeNull();

    // B cannot write reference tables
    const refWrite = await clientB.from('resolution_cache').insert({
      normalized_text: 'rls probe',
      intent: 'food',
    });
    expect(refWrite.error).not.toBeNull();

    // cleanup: A deletes its probe row (A CAN delete its own)
    const cleanup = await clientA.from('entries').delete().eq('user_id', userA);
    expect(cleanup.error).toBeNull();
  }, 30_000);
});

describe.runIf(!enabled)('gate: RLS cross-user denial (BLOCKED)', () => {
  test('NOT RUN — needs .env keys and applied migration; run with RLS_TEST=1', () => {
    console.warn(
      '\n⚠ RLS cross-user gate has NOT been proven. Blocked on: Supabase keys in .env ' +
        '+ migration 0001 applied. Run: RLS_TEST=1 npm test -- test/rls-cross-user.test.ts\n',
    );
    expect(enabled).toBe(false);
  });
});
