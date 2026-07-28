-- Plan D1 — range CHECK constraints on entries.
--
-- entries had CHECKs only on the enum columns (intent/status/context). Every
-- numeric was unbounded, so the client was the sole validator of computed
-- nutrition — a buggy or tampered client could push kcal = -999999, qty = 1e30,
-- negative steps. RLS enforces ownership, never sanity. These mirror the
-- per-intent caps resolver_cache_write already enforces, so the entries table
-- and the cache agree.
--
-- ADD CONSTRAINT ... NOT VALID enforces the bound on every new/updated row
-- without scanning the (pre-launch, but possibly non-empty) table. A follow-up
-- VALIDATE CONSTRAINT can confirm existing rows out of the write path.

alter table entries
  add constraint entries_qty_range
    check (qty is null or (qty > 0 and qty <= 100000)) not valid,
  add constraint entries_step_count_range
    check (step_count is null or (step_count >= 0 and step_count <= 200000)) not valid,
  add constraint entries_water_ml_range
    check (water_ml is null or (water_ml >= 0 and water_ml <= 20000)) not valid,
  add constraint entries_sleep_minutes_range
    check (sleep_minutes is null or (sleep_minutes >= 0 and sleep_minutes <= 1440)) not valid,
  -- kcal is signed: food is positive, exercise/steps are negative credits.
  -- A generous absolute bound catches garbage without clipping real values.
  add constraint entries_kcal_range
    check (kcal is null or (kcal >= -100000 and kcal <= 100000)) not valid;
