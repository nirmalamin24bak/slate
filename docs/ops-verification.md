# Ops verification — backups, PITR, pg_cron

Status: **checklist ready; the restore PROCEDURE is now built and rehearsed, but the real restore against the live `ap-south-1` project still has to be run by Nirmal.** The dashboard steps need authed Supabase access I do not have.

What changed 29 Jul 2026: the restore drill was rehearsed locally end to end against two throwaway Postgres containers, and it found two defects that a row-count check would have passed (§1b). `scripts/verify-restore.mjs` and `scripts/post-restore-repair.sql` came out of that. The real drill is now a short procedure with a pass/fail answer rather than an open-ended "confirm it looks right".

Why this matters: the app treats Supabase as the source of truth (spec/04). If backups aren't enabled or the reaper cron never runs, the failure is silent until the day you need a restore or the tables have grown unbounded. Confirm once before launch, then re-check after any project-settings change.

---

## 1. Backups / PITR (Supabase Dashboard)

Slate holds personal + health data (DPDP). Losing it is both a product and a compliance failure.

**Check (Dashboard → Database → Backups):**

- [ ] **Daily backups are enabled.** Free tier gives daily logical backups with limited retention; Pro adds longer retention. Confirm which tier this project is on and what the retention window actually is.
- [ ] **PITR (Point-In-Time Recovery) status.** PITR is a paid add-on. Decide explicitly: is PITR required for launch, or is a daily backup acceptable for v1? A calorie journal can tolerate a daily-granularity restore; document the choice either way so it's a decision, not an accident.
- [ ] **Run one test restore before launch.** A backup you have never restored is a hope, not a backup. This is the single most valuable item on this page. The procedure is §1a below — **do not just check row counts**, for the reason in §1b.

**Document the answers** in this file (retention window, PITR yes/no, date of the test restore) so the next person doesn't re-investigate.

---

## 1a. The restore drill — procedure

Restore the latest backup into a scratch project, then compare it to the live one:

```powershell
# Both read with Read-Host so neither lands in PSReadLine history.
$env:SOURCE_DB_URL   = (Read-Host 'live project pooler URI')
$env:RESTORED_DB_URL = (Read-Host 'scratch project pooler URI')

node scripts/verify-restore.mjs
```

It compares eight things across the two databases and prints a diff of any that differ: row counts on all fourteen tables, RLS enabled + policy counts, **every policy's USING and WITH CHECK expression**, every function's definer flag and whether `anon`/`authenticated` can execute it, constraints including whether they are `VALIDATED`, indexes, `cron.job`, and extensions.

If it reports differences, apply the repair and re-run:

```powershell
.\scripts\psql.ps1 -File scripts/post-restore-repair.sql   # against the RESTORED database
node scripts/verify-restore.mjs                            # expect a clean result
```

## 1b. What the drill found — read this before trusting a restore

Run locally on 29 Jul 2026 against two `supabase/postgres` containers: full schema, seed and user rows, `pg_dump -Fc` → `pg_restore`. **Every row came back. Two things did not, and neither is visible in a row count.**

**1. Every `SECURITY DEFINER` function came back callable by `anon` and `authenticated`.** Source had `anon=false auth=false` on all seven; the restore had `anon=true auth=true` — the default `PUBLIC` grant, because the ACL statements failed during restore (`pg_restore: warning: errors ignored on restore: 162`). A definer function runs as its owner and bypasses RLS, so a restored production database would let any signed-in user call `reap_resolver_state()` — a mass delete across the resolver tables — and `resolver_cache_write()`, which writes the global cache directly, bypassing the quorum that migration `...20260729000002` exists to enforce.

That is not a degraded restore. It is a **breach, in a database whose row counts all matched**. It is the same defect class as migration `...20260712000001`, which exists because one revoke was missed once.

**2. Both `pg_cron` jobs were gone.** They live in the `cron` schema, not `public`, and did not come back. The reapers then never run, and `resolver_rate_limits` / `resolution_cache_pending` grow without bound — silently, until someone notices the bill.

Both are fixed by `scripts/post-restore-repair.sql`, which re-revokes every definer function (generated from the catalogue, not a hand-written list, so it cannot miss one) and re-schedules both jobs. Re-verified clean afterwards.

**The lesson for the real drill:** a restore is not done when the data is back. It is done when `verify-restore.mjs` is clean.

---

## 2. pg_cron liveness (SQL Editor)

The reaper (`reap_resolver_state`, migrations ...0008 / ...0011) trims `resolver_rate_limits`, `resolver_global_budget`, stale `resolution_cache`, and old `resolution_cache_pending`. It only runs if pg_cron is actually enabled **and** the job is registered. Migration ...0008 issues the `create extension` and `cron.schedule`, but if the migration role lacked rights the extension line no-ops silently and the reaper never runs — the tables then grow unbounded (audit finding).

**Run in the SQL Editor:**

```sql
-- (a) extension present?
select extname from pg_extension where extname = 'pg_cron';
-- expect: one row 'pg_cron'. Empty = enable it: Dashboard → Database →
-- Extensions → pg_cron, then re-run migration 0008's cron.schedule().

-- (b) job registered and active?
select jobid, jobname, schedule, active
from cron.job
where jobname = 'reap-resolver-state';
-- expect: one row, active = true, schedule '30 3 * * *'.

-- (c) has it actually run, and did it succeed? (only after the first 03:30 UTC)
select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'reap-resolver-state')
order by start_time desc
limit 5;
-- expect: recent rows with status 'succeeded'. 'failed' → read return_message.
```

- [ ] (a) returns `pg_cron`
- [ ] (b) returns the job, `active = true`
- [ ] (c) shows a recent `succeeded` run (check the morning after launch)

**Also confirm the EXECUTE revoke landed** (audit C1, migration ...20260712000001) — a non-privileged caller must not be able to invoke the reaper:

```sql
-- run as anon/authenticated (e.g. from the client, or set role):
-- select public.reap_resolver_state();
-- expect: permission denied. If it runs, the revoke migration didn't apply.
select has_function_privilege('authenticated', 'public.reap_resolver_state()', 'execute') as authenticated_can_run,
       has_function_privilege('anon',          'public.reap_resolver_state()', 'execute') as anon_can_run;
-- expect: both false.
```

- [ ] both `false`

---

## 3. Migration deploy safety (audit, tracked — not a blocker for these two items)

Separate but related: `supabase db push` on merge to `main` (ci.yml) auto-applies migrations to prod with no tested rollback. Before a risky migration, run `supabase db diff` / apply it to a branch DB first.

**The harness landed 28 Jul 2026** — `node scripts/db-migration-test.mjs` applies every migration and seed file to a throwaway `supabase/postgres`, re-applies the seeds to prove idempotency, and asserts the schema (row counts, RLS on all twelve tables, the reaper's revoked EXECUTE, validated `entries` constraints). CI runs it on any change under `supabase/`, and the deploy job depends on it. It caught a generated-SQL syntax error on its first run — one that would have failed the production deploy _after_ the schema had already changed.

Two checks on this page are now enforced there as well as here: the reaper `EXECUTE` revoke, and RLS coverage. That does not replace running them against production — the harness proves the migrations produce the right schema, not that production actually received them.

---

## Sign-off

| Item                                     | Checked by | Date | Result |
| ---------------------------------------- | ---------- | ---- | ------ |
| Daily backups enabled + retention known  |            |      |        |
| PITR decision recorded                   |            |      |        |
| Test restore performed                   |            |      |        |
| `verify-restore.mjs` clean after restore |            |      |        |
| pg_cron extension present                |            |      |        |
| reap job registered + active             |            |      |        |
| reaper EXECUTE revoked from client roles |            |      |        |
