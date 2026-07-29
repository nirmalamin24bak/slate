#!/usr/bin/env node
// Compare a restored database against the one it was restored from, and say
// whether the restore is actually usable.
//
//   $env:SOURCE_DB_URL   = (Read-Host 'source (live) URI')
//   $env:RESTORED_DB_URL = (Read-Host 'restored (scratch) URI')
//   node scripts/verify-restore.mjs
//
// Why this exists: docs/ops-verification.md asks for one test restore before
// launch and says to "confirm the four user tables come back with row counts
// matching". Row counts are necessary and nowhere near sufficient. A logical
// restore can bring every row back and still lose:
//
//   * RLS — `alter table ... enable row level security` and the policies
//     themselves. Slate has no login; RLS is the ONLY thing between one
//     person's journal and another's. A restore with rows and no policies is
//     not a degraded restore, it is a data breach you promoted to production.
//   * EXECUTE revokes on SECURITY DEFINER functions. Default grants are to
//     PUBLIC, so a function whose REVOKE did not survive is callable by any
//     signed-in user (this is exactly migration ...20260712000001).
//   * NOT VALID vs VALIDATED constraints — a restored constraint can come back
//     unvalidated, which silently stops guarding the rows already there.
//   * pg_cron jobs. These live in the `cron` schema, not in `public`, and a
//     restore into a NEW project usually does not carry them. The reapers then
//     never run and the rate-limit and pending tables grow forever, silently.
//
// So the fingerprint below is deliberately about structure and permissions as
// much as data. Everything it reads is schema-level or an aggregate count; it
// never reads a journal row.
//
// psql runs in Docker for the same reason scripts/psql.ps1 does — there is no
// psql on the dev machine and no reason to install one. Connection strings come
// from the environment and are passed as libpq PG* variables, so the password
// never appears in an argument list or in `docker ps`.

import { execFileSync } from 'node:child_process';

const IMAGE = 'postgres:15-alpine';

function urlToEnv(raw, label) {
  let uri;
  try {
    uri = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URI`);
  }
  if (!/^postgres(ql)?:$/.test(uri.protocol)) {
    throw new Error(`${label} scheme is '${uri.protocol}', expected postgresql://`);
  }
  if (!uri.username || !uri.password) {
    throw new Error(`${label} has no user:password`);
  }
  return {
    PGUSER: decodeURIComponent(uri.username),
    PGPASSWORD: decodeURIComponent(uri.password),
    PGHOST: uri.hostname,
    PGPORT: uri.port || '5432',
    PGDATABASE: uri.pathname.replace(/^\//, '') || 'postgres',
    // Supabase terminates TLS on the pooler and rejects plaintext. An explicit
    // ?sslmode= wins so a local scratch database with no TLS still works.
    PGSSLMODE: uri.searchParams.get('sslmode') ?? 'require',
  };
}

function query(pgEnv, sql) {
  const args = ['run', '--rm', '-i'];
  for (const name of Object.keys(pgEnv)) args.push('-e', name);
  args.push(IMAGE, 'psql', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '\t');
  let out;
  try {
    out = execFileSync('docker', args, {
      input: sql,
      encoding: 'utf8',
      env: { ...process.env, ...pgEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    // execFileSync's own message is the command line, which says nothing about
    // what went wrong. psql's stderr is the part worth reading — "could not
    // connect", "permission denied", "relation does not exist" are all
    // different findings and the first version of this script hid all three.
    const stderr = String(error.stderr ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    throw new Error(stderr[0] ?? String(error.message));
  }
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// Each probe returns sorted `key<TAB>value` lines. Comparing them line by line
// makes a difference read as a diff rather than as "something changed".
const PROBES = {
  'row counts': `
    select 'ingredients', count(*) from ingredients
    union all select 'dishes', count(*) from dishes
    union all select 'dish_ingredients', count(*) from dish_ingredients
    union all select 'exercises', count(*) from exercises
    union all select 'packaged_foods', count(*) from packaged_foods
    union all select 'entries', count(*) from entries
    union all select 'weights', count(*) from weights
    union all select 'profiles', count(*) from profiles
    union all select 'kitchen', count(*) from kitchen
    union all select 'custom_dishes', count(*) from custom_dishes
    union all select 'custom_dish_ingredients', count(*) from custom_dish_ingredients
    union all select 'entitlements', count(*) from entitlements
    union all select 'account_deletions', count(*) from account_deletions
    union all select 'app_config', count(*) from app_config
    order by 1`,

  // The security boundary. Both halves matter: RLS enabled, AND the policies
  // that make it mean something. A table with RLS on and no policies denies
  // everything (safe but broken); RLS off with policies present allows
  // everything (a breach).
  'RLS + policy count': `
    select c.relname || ' rls=' || c.relrowsecurity,
           (select count(*) from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by 1`,

  // Every policy by name and the expression it enforces. A policy that came
  // back with a different USING clause is worse than one that vanished.
  'policy definitions': `
    select tablename || '.' || policyname,
           coalesce(qual, '-') || ' | ' || coalesce(with_check, '-')
    from pg_policies where schemaname = 'public'
    order by 1`,

  // Definer functions and whether a client role can call them.
  'function grants': `
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
             || ' definer=' || p.prosecdef,
           'anon=' || has_function_privilege('anon', p.oid, 'execute')
             || ' auth=' || has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by 1`,

  // convalidated matters: an unvalidated CHECK stops guarding existing rows.
  // contype is "char", whose || is ambiguous — cast it explicitly.
  constraints: `
    select conrelid::regclass || '.' || conname,
           contype::text || ' valid=' || convalidated
    from pg_constraint
    where connamespace = 'public'::regnamespace
    order by 1`,

  indexes: `
    select schemaname || '.' || indexname, indexdef
    from pg_indexes where schemaname = 'public'
    order by 1`,

  // The one most likely to differ, and the one nobody thinks to check: a
  // restore into a new project routinely brings the extension and not the jobs.
  'cron jobs': `
    select coalesce(jobname, '(none)'), coalesce(schedule, '-') || ' active=' || coalesce(active::text, '-')
    from cron.job
    union all
    select '(no cron.job rows)', '-'
    where not exists (select 1 from cron.job)
    order by 1`,

  extensions: `select extname, extversion from pg_extension order by 1`,
};

function main() {
  // Static access: eslint-config-expo forbids bracket lookups on process.env,
  // because a dynamic key cannot be checked or inlined.
  const sourceUrl = process.env.SOURCE_DB_URL;
  const restoredUrl = process.env.RESTORED_DB_URL;
  if (!sourceUrl || !restoredUrl) {
    console.error(
      'Set both SOURCE_DB_URL and RESTORED_DB_URL (see docs/ops-verification.md).\n' +
        'Do not type them inline — use Read-Host so they stay out of shell history.',
    );
    process.exit(2);
  }

  const source = urlToEnv(sourceUrl, 'SOURCE_DB_URL');
  const restored = urlToEnv(restoredUrl, 'RESTORED_DB_URL');

  let failures = 0;
  for (const [label, sql] of Object.entries(PROBES)) {
    let a;
    let b;
    try {
      a = query(source, sql);
      b = query(restored, sql);
    } catch (error) {
      // A probe that cannot run on one side is itself a finding — e.g. `cron.job`
      // missing entirely means pg_cron did not come back.
      console.log(`✗ ${label}: probe failed — ${String(error.message).split('\n')[0]}`);
      failures++;
      continue;
    }

    const onlySource = a.filter((l) => !b.includes(l));
    const onlyRestored = b.filter((l) => !a.includes(l));
    if (onlySource.length === 0 && onlyRestored.length === 0) {
      console.log(`✓ ${label}: identical (${a.length} rows)`);
      continue;
    }
    failures++;
    console.log(`✗ ${label}:`);
    for (const line of onlySource) console.log(`    source only:   ${line}`);
    for (const line of onlyRestored) console.log(`    restored only: ${line}`);
  }

  console.log('');
  if (failures > 0) {
    console.error(
      `✗ ${failures} difference(s). The restore is NOT equivalent to the source — read each\n` +
        '  line above before trusting it. A cron.job difference is expected when restoring\n' +
        '  into a new project and must be fixed by re-running the schedule, not ignored.',
    );
    process.exit(1);
  }
  console.log('✓ the restored database matches the source in data, RLS, grants and schedule.');
}

main();
