-- Data D6 — the promised follow-up to migration ...0007.
--
-- Migration 0007 added five range CHECK constraints to entries as NOT VALID:
-- the bound enforces on every new/updated row, but existing rows were never
-- checked, and its comment promised "A follow-up VALIDATE CONSTRAINT can
-- confirm existing rows." That follow-up was never written. Any row already in
-- entries when 0007 ran — including garbage pushed by a buggy client before the
-- constraints existed — is permanently unchecked, and because the app writes
-- SQLite-first then syncs, that garbage would sit on the server as truth.
--
-- VALIDATE CONSTRAINT scans the table once to confirm every existing row
-- satisfies the bound, then marks the constraint validated. It takes only a
-- SHARE UPDATE EXCLUSIVE lock (reads and writes continue), so it is safe to run
-- online. If any pre-existing row violates a bound this migration will ERROR
-- with the offending constraint — that is the point: surface bad data rather
-- than let it masquerade as validated. (Fix the row, then re-run.)

alter table entries validate constraint entries_qty_range;
alter table entries validate constraint entries_step_count_range;
alter table entries validate constraint entries_water_ml_range;
alter table entries validate constraint entries_sleep_minutes_range;
alter table entries validate constraint entries_kcal_range;
