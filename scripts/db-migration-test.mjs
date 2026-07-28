#!/usr/bin/env node
// Apply every migration and every seed file to a throwaway Postgres, in order,
// and assert the result. The thing this replaces is hope.
//
//   node scripts/db-migration-test.mjs [--image supabase/postgres:15.8.1.060]
//     [--keep]     leave the container running for inspection
//     [--port 55432]
//
// Why this exists: the deploy job runs `supabase db push` on merge to main,
// which is the first time any of this SQL meets a real schema — auto-applied,
// against production, with no rollback. The seed files had never been executed
// at all. A migration that only fails in production is a migration nobody
// tested; this makes the failure happen here instead.
//
// The image is supabase/postgres rather than stock postgres because the
// migrations use pg_cron and the auth schema. Stock Postgres would fail on
// `create extension pg_cron`, and stubbing it out would test a different file
// than the one that ships.

import { execFileSync, execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const IMAGE = arg('image', 'supabase/postgres:15.8.1.060');
const PORT = arg('port', '55432');
const NAME = 'slate-migration-test';
const KEEP = process.argv.includes('--keep');

const MIGRATIONS_DIR = 'supabase/migrations';
const SEED_DIR = 'supabase/seed';

// Roles Supabase creates for you. Present in the image, but a migration that
// grants to a role the image lacks should fail loudly here, not in production.
const PRELUDE = `
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
`;

// One test user, so the foreign keys into auth.users have something to point at
// and the RLS smoke test below has a row to own.
const TEST_UID = '11111111-1111-1111-1111-111111111111';

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function sleep(seconds) {
  execSync(
    process.platform === 'win32' ? `ping -n ${seconds + 1} 127.0.0.1 > NUL` : `sleep ${seconds}`,
  );
}

// The image runs its own init pass, then shuts the server down and starts it
// again for real. A psql that lands in that window dies with "the database
// system is shutting down" — a container lifecycle event, not a SQL error, so
// retry it rather than reporting a migration failure that didn't happen.
const TRANSIENT = /shutting down|starting up|connection to server|no response|Connection refused/i;

function psql(sql, { quiet = true } = {}) {
  const args = [
    'exec',
    '-i',
    NAME,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
  ].concat(quiet ? ['-q'] : []);
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return execFileSync('docker', args, { input: sql, encoding: 'utf8' });
    } catch (error) {
      lastError = error;
      if (!TRANSIENT.test(String(error.stderr ?? ''))) throw error;
      sleep(3);
    }
  }
  throw lastError;
}

function scalar(sql) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      NAME,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function teardown() {
  try {
    sh(`docker rm -f ${NAME}`);
  } catch {
    /* already gone */
  }
}

const failures = [];
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
}

teardown();
console.log(`starting ${IMAGE} as ${NAME} on :${PORT}`);
sh(
  `docker run -d --name ${NAME} -e POSTGRES_PASSWORD=postgres -e POSTGRES_HOST_AUTH_METHOD=trust -p ${PORT}:5432 ${IMAGE}`,
);

try {
  // Not "is it up" but "has it stayed up" — the image's init pass answers
  // pg_isready and then stops the server, so a single success proves nothing.
  process.stdout.write('waiting for postgres to settle');
  let consecutive = 0;
  for (let i = 0; i < 120 && consecutive < 5; i++) {
    try {
      sh(`docker exec ${NAME} pg_isready -U postgres`);
      consecutive++;
    } catch {
      consecutive = 0;
      process.stdout.write('.');
    }
    sleep(2);
  }
  console.log('');
  if (consecutive < 5) throw new Error('postgres never stayed ready');

  psql(PRELUDE);
  psql(`insert into auth.users (id) values ('${TEST_UID}') on conflict do nothing;`);

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrations) {
    process.stdout.write(`  ${file} … `);
    psql(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    console.log('ok');
  }
  console.log(`applied ${migrations.length} migrations`);

  const seeds = readdirSync(SEED_DIR)
    .filter((f) => /^\d.*\.sql$/.test(f))
    .sort();
  for (const file of seeds) {
    process.stdout.write(`  ${file} … `);
    psql(readFileSync(join(SEED_DIR, file), 'utf8'));
    console.log('ok');
  }
  console.log(`applied ${seeds.length} seed files`);

  // Idempotency is the whole design of the seed — a corrected recipe ships by
  // re-applying it. Prove re-running changes nothing rather than duplicating.
  const before = scalar('select count(*) from dish_ingredients');
  for (const file of seeds) psql(readFileSync(join(SEED_DIR, file), 'utf8'));
  check('seed is idempotent (dish_ingredients unchanged on re-apply)', before, before);
  check('dish_ingredients after re-apply', scalar('select count(*) from dish_ingredients'), before);

  const dishes = JSON.parse(readFileSync(join(SEED_DIR, 'dishes.draft.json'), 'utf8'));
  const exercises = JSON.parse(readFileSync(join(SEED_DIR, 'exercises.draft.json'), 'utf8'));
  const expectedIngredientRows = dishes.reduce((n, d) => n + d.ingredients.length, 0);
  const expectedServingG = dishes.filter((d) => typeof d.serving_g === 'number').length;

  check('ingredients', scalar('select count(*) from ingredients'), 549);
  check('dishes', scalar('select count(*) from dishes'), dishes.length);
  check(
    'dish_ingredients',
    scalar('select count(*) from dish_ingredients'),
    expectedIngredientRows,
  );
  check('exercises', scalar('select count(*) from exercises'), exercises.length);
  check(
    'dishes with serving_g',
    scalar('select count(*) from dishes where serving_g is not null'),
    expectedServingG,
  );
  check(
    'no dish ingredient points at a missing ingredient',
    scalar(
      'select count(*) from dish_ingredients di left join ingredients i on i.id = di.ingredient_id where i.id is null',
    ),
    0,
  );
  check(
    'aliases survive as a real text[]',
    scalar("select array_length(aliases, 1) from dishes where id = 'dish_dal_toor'"),
    4,
  );

  // RLS is the security boundary the whole no-login design rests on (spec/04).
  // Every user table must have it enabled after the full migration chain.
  const rlsGaps = scalar(`
    select coalesce(string_agg(c.relname, ','), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      and c.relname in ('entries','weights','profiles','kitchen','custom_dishes',
                        'custom_dish_ingredients','entitlements','ingredients',
                        'dishes','dish_ingredients','exercises','packaged_foods')`);
  check('every user + reference table has RLS enabled', rlsGaps || '(none)', '(none)');

  // The reaper must not be callable by a client role (audit C1, migration
  // 20260712000001). This is the check ops-verification.md asks you to run in
  // production; running it here means a regression fails in CI first.
  check(
    'reaper EXECUTE revoked from authenticated',
    scalar(
      "select has_function_privilege('authenticated', 'public.reap_resolver_state()', 'execute')",
    ),
    'f',
  );
  check(
    'reaper EXECUTE revoked from anon',
    scalar("select has_function_privilege('anon', 'public.reap_resolver_state()', 'execute')"),
    'f',
  );

  // entries CHECK constraints were added and then VALIDATEd separately so the
  // lock stays brief; both halves have to have landed.
  check(
    'entries check constraints are validated',
    scalar(
      "select count(*) from pg_constraint where conrelid = 'public.entries'::regclass and contype = 'c' and not convalidated",
    ),
    0,
  );

  console.log('');
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} check(s) failed: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('✓ migrations + seed apply cleanly and the schema is what the app expects');
  }
} finally {
  if (KEEP) console.log(`container ${NAME} left running on :${PORT} (--keep)`);
  else teardown();
}
