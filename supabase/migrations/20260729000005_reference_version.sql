-- Audit M4 — let a device know whether the reference data changed, without
-- downloading it to find out.
--
-- pullReference does four unfiltered `select *` calls over ingredients, dishes,
-- dish_ingredients, exercises and packaged_foods — the whole tables — and the
-- client ran it on EVERY launch, awaited, before the journal was usable. At the
-- dish-table target of 400-600 rows plus a real packaged-food table that is a
-- multi-MB transfer between tapping the icon and being able to type, which
-- CLAUDE.md's one-sentence test says is always the wrong trade, and it is
-- Supabase egress billed per launch per user forever.
--
-- A monotonic counter is enough to fix it. The client keeps the version it last
-- mirrored; if the server's matches, it transfers nothing. There is no need for
-- per-table granularity or content hashing: reference data changes when a seed
-- is applied, which is a deploy, which is rare and global.
--
-- The deploy job bumps this after applying the seed files (.github/workflows/ci.yml).
-- Bumping it costs a device one refresh; failing to bump it leaves devices on a
-- stale mirror, so the bump belongs next to the seed apply and not in a migration
-- that might not run.

alter table app_config
  add column if not exists reference_version integer not null default 1;

comment on column app_config.reference_version is
  'Bumped by the deploy job after the reference seed applies. A client mirrors '
  'reference tables only when its stored version differs. See audit M4.';
