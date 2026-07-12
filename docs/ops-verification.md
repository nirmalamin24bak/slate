# Ops verification — backups, PITR, pg_cron

Status: **checklist ready; the SQL/dashboard checks below must be run by Nirmal against the live `ap-south-1` project.** I cannot run them from here (no authed Supabase access). None of this is code — it's confirming the production project is configured the way the app assumes.

Why this matters: the app treats Supabase as the source of truth (spec/04). If backups aren't enabled or the reaper cron never runs, the failure is silent until the day you need a restore or the tables have grown unbounded. Confirm once before launch, then re-check after any project-settings change.

---

## 1. Backups / PITR (Supabase Dashboard)

Slate holds personal + health data (DPDP). Losing it is both a product and a compliance failure.

**Check (Dashboard → Database → Backups):**

- [ ] **Daily backups are enabled.** Free tier gives daily logical backups with limited retention; Pro adds longer retention. Confirm which tier this project is on and what the retention window actually is.
- [ ] **PITR (Point-In-Time Recovery) status.** PITR is a paid add-on. Decide explicitly: is PITR required for launch, or is a daily backup acceptable for v1? A calorie journal can tolerate a daily-granularity restore; document the choice either way so it's a decision, not an accident.
- [ ] **Run one test restore before launch.** A backup you have never restored is a hope, not a backup. Restore the latest backup into a scratch project and confirm the four user tables (`entries`, `weights`, `profiles`, `kitchen`) come back intact with row counts matching. This is the single most valuable item on this page.

**Document the answers** in this file (retention window, PITR yes/no, date of the test restore) so the next person doesn't re-investigate.

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

Separate but related: `supabase db push` on merge to `main` (ci.yml) auto-applies migrations to prod with no dry-run gate and no tested rollback, and CI never runs the SQL against a populated DB. Before a risky migration, run `supabase db diff` / apply it to a branch DB first. A proper migration-test harness in CI is the follow-up; noted here so it isn't forgotten.

---

## Sign-off

| Item                                     | Checked by | Date | Result |
| ---------------------------------------- | ---------- | ---- | ------ |
| Daily backups enabled + retention known  |            |      |        |
| PITR decision recorded                   |            |      |        |
| Test restore performed                   |            |      |        |
| pg_cron extension present                |            |      |        |
| reap job registered + active             |            |      |        |
| reaper EXECUTE revoked from client roles |            |      |        |
