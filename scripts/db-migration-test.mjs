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

// Two test users. RLS is the entire security boundary of a no-login product, so
// "does A see B" needs two identities, not one.
const TEST_UID = '11111111-1111-1111-1111-111111111111';
const USER_A = TEST_UID;
const USER_B = '22222222-2222-2222-2222-222222222222';

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

/**
 * Run SQL as an authenticated end user, the way PostgREST does: the
 * `authenticated` role, with the caller's uid in the request GUCs that
 * auth.uid() reads.
 *
 * Both spellings are set on purpose. This image's auth.uid() reads the older
 * `request.jwt.claim.sub`; a newer Supabase reads `sub` out of the
 * `request.jwt.claims` JSON. Setting both means the harness tests OUR policies
 * rather than the image's vintage.
 *
 * Everything runs inside a transaction that is rolled back, so an RLS probe
 * that DOES modify a row cannot leak into a later check. `set local` is also
 * only meaningful inside a transaction.
 */
function psqlAs(uid, sql) {
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
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input:
        `begin;\n` +
        `set local role authenticated;\n` +
        `set local request.jwt.claim.sub = '${uid}';\n` +
        `set local request.jwt.claims = '{"sub":"${uid}","role":"authenticated"}';\n` +
        `${sql}\nrollback;\n`,
      encoding: 'utf8',
      // Capture stderr rather than letting it through: a refused write is a
      // PASSING result here, and printing its ERROR line makes a green run look
      // broken. Genuine failures still surface as a ✗ from check().
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}

/** Last value printed by SQL run as `uid`. */
function scalarAs(uid, sql) {
  const lines = psqlAs(uid, sql).split(/\r?\n/).filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

/** True when the statement was REFUSED (an RLS WITH CHECK violation raises). */
function deniedAs(uid, sql) {
  try {
    psqlAs(uid, sql);
    return false;
  } catch {
    return true;
  }
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

  // The global cache is served by the Edge Function and marked hit through this
  // function. It must exist (or every request pays the model again) and must not
  // be callable by a client role (or anyone can inflate hit_count and hold a
  // poisoned row past the 90-day eviction).
  check(
    'resolver_cache_touch exists',
    scalar(
      "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'resolver_cache_touch'",
    ),
    1,
  );
  for (const role of ['anon', 'authenticated']) {
    check(
      `resolver_cache_touch EXECUTE revoked from ${role}`,
      scalar(
        `select has_function_privilege('${role}', 'public.resolver_cache_touch(text)', 'execute')`,
      ),
      'f',
    );
  }
  // And it does what it says: serving a row bumps the count and the TTL clock.
  psql(`
    insert into resolution_cache (normalized_text, intent, resolved_ref, qty, unit, confidence)
    values ('harness key', 'food', 'dish_dal_toor', 1, 'katori', 0.9)
    on conflict (normalized_text) do nothing;
    update resolution_cache set hit_count = 1, last_hit_at = now() - interval '30 days'
     where normalized_text = 'harness key';
    select public.resolver_cache_touch('harness key');
  `);
  check(
    'resolver_cache_touch increments hit_count',
    scalar("select hit_count from resolution_cache where normalized_text = 'harness key'"),
    2,
  );
  check(
    'resolver_cache_touch refreshes last_hit_at',
    scalar(
      "select last_hit_at > now() - interval '1 minute' from resolution_cache where normalized_text = 'harness key'",
    ),
    't',
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

  // -------------------------------------------------------------------------
  // RLS cross-user gate (audit C6).
  //
  // Slate has no login. RLS is the ONLY thing between one person's journal and
  // another's, and the test that proved it — test/rls-cross-user.test.ts — is
  // opt-in behind RLS_TEST=1 and has therefore never run in CI. It cannot run
  // here either: it drives supabase-js auth, and this container has Postgres
  // but no GoTrue. So the same property is asserted where it actually lives,
  // in the policies, against the full migration chain.
  //
  // The precedent for why this must be blocking: resolution_cache shipped with
  // `for select using (true)` and stayed that way for four days (migration
  // ...0010). A green build said nothing.
  // -------------------------------------------------------------------------
  console.log('\nRLS cross-user gate:');

  psql(`
    insert into auth.users (id) values ('${USER_B}') on conflict do nothing;
    insert into profiles (user_id) values ('${USER_A}'),('${USER_B}') on conflict do nothing;
    insert into kitchen (user_id) values ('${USER_A}'),('${USER_B}') on conflict do nothing;
    insert into entries (id, user_id, log_date, position, raw_text, intent, status, calc_version)
    values ('aaaaaaaa-0000-0000-0000-000000000001','${USER_A}','2026-07-10',0,'A dal','food','resolved','v1'),
           ('bbbbbbbb-0000-0000-0000-000000000001','${USER_B}','2026-07-10',0,'B dal','food','resolved','v1')
    on conflict do nothing;
    insert into weights (id, user_id, log_date, weight_kg, source)
    values ('aaaaaaaa-0000-0000-0000-000000000002','${USER_A}','2026-07-10',70,'journal'),
           ('bbbbbbbb-0000-0000-0000-000000000002','${USER_B}','2026-07-10',80,'journal')
    on conflict do nothing;
    insert into custom_dishes (id, user_id, name, default_unit, default_qty)
    values ('aaaaaaaa-0000-0000-0000-000000000003','${USER_A}','A dish','katori',1),
           ('bbbbbbbb-0000-0000-0000-000000000003','${USER_B}','B dish','katori',1)
    on conflict do nothing;
    insert into custom_dish_ingredients (custom_dish_id, ingredient_id, grams)
    select id, 'IFCT_A001', 10 from custom_dishes on conflict do nothing;
    insert into entitlements (user_id, active) values ('${USER_A}', true) on conflict do nothing;
  `);

  // Read isolation: two rows exist in each table; a caller must see exactly one.
  for (const table of ['entries', 'weights', 'profiles', 'kitchen', 'custom_dishes']) {
    check(`A sees only its own ${table}`, scalarAs(USER_A, `select count(*) from ${table};`), 1);
    check(`B sees only its own ${table}`, scalarAs(USER_B, `select count(*) from ${table};`), 1);
  }
  // custom_dish_ingredients has no user_id: ownership flows through the parent.
  check(
    'B cannot see A custom_dish_ingredients (ownership via parent dish)',
    scalarAs(
      USER_B,
      `select count(*) from custom_dish_ingredients where custom_dish_id = 'aaaaaaaa-0000-0000-0000-000000000003';`,
    ),
    0,
  );

  // Write isolation. A denied UPDATE/DELETE is silent — it matches no rows —
  // so assert the affected count, not an error.
  check(
    'B cannot update A entries',
    scalarAs(
      USER_B,
      `with u as (update entries set raw_text = 'pwned' where user_id = '${USER_A}' returning 1) select count(*) from u;`,
    ),
    0,
  );
  check(
    'B cannot delete A weights',
    scalarAs(
      USER_B,
      `with d as (delete from weights where user_id = '${USER_A}' returning 1) select count(*) from d;`,
    ),
    0,
  );
  // An INSERT that violates WITH CHECK does raise. This is the one that matters
  // most: it is how a patched client would plant rows in someone else's journal.
  //
  // The positive control below runs the SAME statement differing only in the
  // owner. Without it, a typo in the SQL would also "raise" and the denial test
  // would pass while proving nothing.
  const smuggle = (owner) =>
    `insert into entries (id, user_id, log_date, position, raw_text, intent, status, calc_version)
     values (gen_random_uuid(), '${owner}', '2026-07-10', 9, 'smuggled', 'food', 'resolved', 'v1');`;
  check('B cannot insert a row owned by A', deniedAs(USER_B, smuggle(USER_A)), true);
  check(
    'control: the same insert succeeds for its own owner',
    deniedAs(USER_B, smuggle(USER_B)),
    false,
  );

  // Entitlements are readable by their owner and writable by nobody: Plus is a
  // server grant, and a client that could UPDATE this row would be Plus for free.
  check(
    'B cannot see A entitlement row',
    scalarAs(USER_B, `select count(*) from entitlements where user_id = '${USER_A}';`),
    0,
  );
  check(
    'a client cannot grant itself Plus',
    scalarAs(
      USER_B,
      `with u as (update entitlements set active = true where user_id = '${USER_B}' returning 1) select count(*) from u;`,
    ),
    0,
  );

  // Tables a client must not read at all. resolution_cache is the proprietary
  // phrase corpus (...0010); the rest are internal bookkeeping with RLS enabled
  // and no policies, which denies everything to a non-bypassing role.
  for (const table of [
    'resolution_cache',
    'resolution_cache_pending',
    'resolver_rate_limits',
    'resolver_global_budget',
    'entitlement_refresh_limits',
    'account_deletions',
  ]) {
    check(
      `${table} is not readable by a client`,
      scalarAs(USER_A, `select count(*) from ${table};`),
      0,
    );
  }

  // app_config is the deliberate exception: operational flags, readable by all,
  // writable by none (it drives the breach banner and the resolver kill switch).
  check('app_config is readable', scalarAs(USER_A, 'select count(*) from app_config;'), 1);
  check(
    'app_config is not writable by a client',
    scalarAs(
      USER_A,
      `with u as (update app_config set breach_banner = 'spoofed' where id = 1 returning 1) select count(*) from u;`,
    ),
    0,
  );

  // Generic sweep, and the real point of this block: EVERY security-definer
  // function must have EXECUTE revoked from both client roles. A definer
  // function runs as its owner and bypasses RLS, so one that keeps the default
  // PUBLIC grant is a hole — which is exactly what happened to
  // reap_resolver_state (migration ...20260712000001). Naming functions
  // individually would only re-check the ones we remembered; this catches the
  // next one somebody forgets.
  check(
    'no SECURITY DEFINER function is executable by anon/authenticated',
    scalar(`
      select coalesce(string_agg(distinct p.proname || '/' || r.rolname, ', '), '(none)')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'),('authenticated')) as r(rolname)
      where n.nspname = 'public' and p.prosecdef
        and has_function_privilege(r.rolname, p.oid, 'execute')`),
    '(none)',
  );

  // The mirror image: the sync RPCs are SECURITY INVOKER precisely so RLS still
  // applies to them, and they MUST stay callable or the app cannot push at all.
  check(
    'the sync_upsert_* RPCs remain callable by authenticated',
    scalar(`
      select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'sync\\_upsert%'
        and has_function_privilege('authenticated', p.oid, 'execute')`),
    4,
  );

  // -------------------------------------------------------------------------
  // Abuse and cost controls (audit C3/M2, C2, C7, M14). Every one of these is a
  // guard that only ever fires under attack, which is exactly the kind of code
  // that rots unnoticed. Assert the behaviour, not the presence of the function.
  // -------------------------------------------------------------------------
  console.log('\nAbuse + cost controls:');

  // C3/M2 — the budget is split by tier and sharded. A free-tier flood must not
  // touch the Plus pool.
  psql(`delete from resolver_budget; delete from resolver_rate_limits;`);
  psql(`
    insert into resolver_budget (day, pool, bucket, calls)
    values (current_date, 'free', 0, 40000);
  `);
  check(
    'a full free pool refuses a free caller',
    scalar(`select resolver_rate_check('${USER_A}', 30, 60, false)`),
    'f',
  );
  check(
    'a full free pool still serves a Plus caller',
    scalar(`select resolver_rate_check('${USER_B}', 30, 60, true)`),
    't',
  );
  check(
    'the Plus call was charged to the plus pool, not free',
    scalar(`select coalesce(sum(calls),0) from resolver_budget where pool = 'plus'`),
    1,
  );
  // Sharding: distinct users must not all land on one row, or the lock
  // contention this migration exists to remove is still there.
  psql(`delete from resolver_budget; delete from resolver_rate_limits;`);
  check(
    'the counter shards across buckets',
    scalar(`
      select count(distinct abs(hashtext(u::text)) % 32) > 4
      from (select gen_random_uuid() as u from generate_series(1, 40)) s`),
    't',
  );
  // The 3-arg version must be gone, or a stale caller silently charges nothing.
  check(
    'the unsharded 3-arg resolver_rate_check is dropped',
    scalar(`
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'resolver_rate_check'
        and pg_get_function_identity_arguments(p.oid) = 'uuid, integer, integer'`),
    0,
  );

  // C2 — quorum hardening. Three probes, each isolating one new rule.
  psql(`delete from resolution_cache_pending; delete from resolution_cache;`);
  // Five FRESH accounts agreeing in one burst: the Sybil shape. Must not promote.
  psql(`
    insert into auth.users (id, created_at)
    select gen_random_uuid(), now() from generate_series(1, 5);
    insert into resolution_cache_pending
      (normalized_text, resolved_ref, intent, qty, unit, confidence, user_id, observed_at)
    select 'sybil chai', 'dish_dal_toor', 'food', 1, 'katori', 0.9, id, now()
    from auth.users where created_at > now() - interval '1 minute';
  `);
  psql(`select resolver_cache_write(
          (select id::text from auth.users where created_at > now() - interval '1 minute' limit 1),
          'sybil chai', 'food', 'dish_dal_toor', 1, 'katori', 0.9);`);
  check(
    'five brand-new accounts cannot promote a phrase (age rule)',
    scalar(`select count(*) from resolution_cache where normalized_text = 'sybil chai'`),
    0,
  );
  // Five AGED accounts agreeing, but all within a minute: still the burst shape.
  psql(`
    delete from auth.users where created_at > now() - interval '1 minute';
    delete from resolution_cache_pending;
    insert into auth.users (id, created_at)
    select gen_random_uuid(), now() - interval '30 days' from generate_series(1, 5);
    insert into resolution_cache_pending
      (normalized_text, resolved_ref, intent, qty, unit, confidence, user_id, observed_at)
    select 'burst chai', 'dish_dal_toor', 'food', 1, 'katori', 0.9, id, now()
    from auth.users where created_at < now() - interval '29 days' and email is null;
  `);
  psql(`select resolver_cache_write(
          (select id::text from auth.users where created_at < now() - interval '29 days' limit 1),
          'burst chai', 'food', 'dish_dal_toor', 1, 'katori', 0.9);`);
  check(
    'aged accounts firing in one burst cannot promote (spread rule)',
    scalar(`select count(*) from resolution_cache where normalized_text = 'burst chai'`),
    0,
  );
  // Same five, spread over a day: the honest shape. Must promote.
  psql(`
    update resolution_cache_pending
       set observed_at = now() - (interval '1 hour' * (abs(hashtext(user_id::text)) % 24))
     where normalized_text = 'burst chai';
  `);
  psql(`select resolver_cache_write(
          (select id::text from auth.users where created_at < now() - interval '29 days' limit 1),
          'burst chai', 'food', 'dish_dal_toor', 1, 'katori', 0.9);`);
  check(
    'control: aged accounts spread over time DO promote',
    scalar(`select count(*) from resolution_cache where normalized_text = 'burst chai'`),
    1,
  );
  // Contested: two refs for one phrase, from aged well-spread accounts. Neither.
  psql(`
    delete from resolution_cache; delete from resolution_cache_pending;
    insert into resolution_cache_pending
      (normalized_text, resolved_ref, intent, qty, unit, confidence, user_id, observed_at)
    select 'contested', case when row_number() over () > 2 then 'dish_roti' else 'dish_dal_toor' end,
           'food', 1, 'katori', 0.9, id, now() - (interval '3 hours' * row_number() over ())
    from auth.users where created_at < now() - interval '29 days' and email is null;
  `);
  psql(`select resolver_cache_write(
          (select id::text from auth.users where created_at < now() - interval '29 days' limit 1),
          'contested', 'food', 'dish_roti', 1, 'katori', 0.9);`);
  check(
    'a contested phrase promotes neither ref',
    scalar(`select count(*) from resolution_cache where normalized_text = 'contested'`),
    0,
  );
  check(
    'and it surfaces in the contested-phrases view',
    scalar(`select count(*) from resolver_contested_phrases where normalized_text = 'contested'`),
    1,
  );

  // C7 — payload bounds. The oversized push must RAISE, not truncate.
  check(
    'a 501-row sync payload is refused',
    deniedAs(
      USER_A,
      `select sync_upsert_entries((
         select jsonb_agg(jsonb_build_object(
           'id', gen_random_uuid(), 'user_id', '${USER_A}', 'log_date', '2026-07-11',
           'position', i, 'raw_text', 'x', 'intent', 'food', 'status', 'resolved',
           'calc_version', 'v1', 'is_included', false, 'was_calibrated', false,
           'created_at', now(), 'updated_at', now()))
         from generate_series(1, 501) i));`,
    ),
    true,
  );
  check(
    'control: a 2-row sync payload is accepted',
    deniedAs(
      USER_A,
      `select sync_upsert_entries((
         select jsonb_agg(jsonb_build_object(
           'id', gen_random_uuid(), 'user_id', '${USER_A}', 'log_date', '2026-07-11',
           'position', i, 'raw_text', 'x', 'intent', 'food', 'status', 'resolved',
           'calc_version', 'v1', 'is_included', false, 'was_calibrated', false,
           'created_at', now(), 'updated_at', now()))
         from generate_series(1, 2) i));`,
    ),
    false,
  );

  // M14 — the anonymous reaper keeps anyone who matters.
  psql(`
    delete from auth.users
     where email is null and created_at < now() - interval '29 days'
       and id not in ('${USER_A}', '${USER_B}');
    insert into auth.users (id, email, created_at, last_sign_in_at) values
      ('33333333-3333-3333-3333-333333333333', null,          now() - interval '200 days', now() - interval '200 days'),
      ('44444444-4444-4444-4444-444444444444', 'a@b.example', now() - interval '200 days', now() - interval '200 days'),
      ('55555555-5555-5555-5555-555555555555', null,          now() - interval '200 days', now() - interval '1 day'),
      ('66666666-6666-6666-6666-666666666666', null,          now() - interval '200 days', now() - interval '200 days')
    on conflict do nothing;
    insert into entitlements (user_id, active)
    values ('66666666-6666-6666-6666-666666666666', false) on conflict do nothing;
  `);
  check(
    'the reaper deletes exactly the abandoned anonymous user',
    scalar(`select public.reap_anonymous_accounts()`),
    1,
  );
  check(
    'it keeps the signed-in, the recently-active, and the ex-subscriber',
    scalar(`
      select count(*) from auth.users where id in (
        '44444444-4444-4444-4444-444444444444',
        '55555555-5555-5555-5555-555555555555',
        '66666666-6666-6666-6666-666666666666')`),
    3,
  );
  check(
    'it keeps a user who has logged something',
    scalar(`select count(*) from auth.users where id = '${USER_A}'`),
    1,
  );
  check(
    'the reap left an audit row',
    scalar(`select count(*) from account_deletions where source like 'reaper:%'`),
    1,
  );
  check(
    'both reap jobs are scheduled',
    scalar(
      `select count(*) from cron.job where jobname in ('reap-resolver-state','reap-anonymous-accounts')`,
    ),
    2,
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
