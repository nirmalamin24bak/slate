-- Plan B1c — updated_at-guarded upsert RPCs for the four user-owned tables.
--
-- The client push used a plain PostgREST upsert: an unconditional
-- ON CONFLICT DO UPDATE. A device holding a stale copy could overwrite a newer
-- server row (cross-device lost edit). supabase-js cannot express a
-- conditional conflict WHERE, so these RPCs do it in SQL: a row is written only
-- when the incoming updated_at is strictly newer than what is stored.
--
-- security invoker (the default, stated for intent): RLS "own rows" still
-- applies, so a caller can only ever write rows where auth.uid() = user_id.
-- The functions take the same snake_case row shape the client already pushes
-- (local-only columns dirty/retryable are stripped before the call).
--
-- Weights conflict on the NATURAL key (user_id, log_date), not id: two devices
-- logging the same day mint different UUIDs but must converge to the one row
-- the unique(user_id, log_date) constraint allows.

create or replace function public.sync_upsert_entries(rows jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into entries
  select * from jsonb_populate_recordset(null::entries, rows)
  on conflict (id) do update set
    log_date = excluded.log_date, position = excluded.position,
    raw_text = excluded.raw_text, nickname = excluded.nickname,
    intent = excluded.intent, status = excluded.status,
    resolved_ref = excluded.resolved_ref, qty = excluded.qty,
    unit = excluded.unit, context = excluded.context, kcal = excluded.kcal,
    protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g, fiber_g = excluded.fiber_g,
    sugar_g = excluded.sugar_g, water_ml = excluded.water_ml,
    step_count = excluded.step_count, sleep_minutes = excluded.sleep_minutes,
    is_included = excluded.is_included, calc_version = excluded.calc_version,
    was_calibrated = excluded.was_calibrated, updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at
  where excluded.updated_at > entries.updated_at;
$$;

create or replace function public.sync_upsert_weights(rows jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into weights
  select * from jsonb_populate_recordset(null::weights, rows)
  on conflict (user_id, log_date) do update set
    weight_kg = excluded.weight_kg, source = excluded.source,
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
  where excluded.updated_at > weights.updated_at;
$$;

create or replace function public.sync_upsert_profiles(rows jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into profiles
  select * from jsonb_populate_recordset(null::profiles, rows)
  on conflict (user_id) do update set
    dob = excluded.dob, sex = excluded.sex, height_cm = excluded.height_cm,
    weight_kg = excluded.weight_kg, weight_is_assumed = excluded.weight_is_assumed,
    calorie_goal = excluded.calorie_goal, protein_goal_g = excluded.protein_goal_g,
    carbs_goal_g = excluded.carbs_goal_g, fat_goal_g = excluded.fat_goal_g,
    unit_height = excluded.unit_height, hide_calories = excluded.hide_calories,
    show_macros = excluded.show_macros, show_fiber_sugar = excluded.show_fiber_sugar,
    show_exercise = excluded.show_exercise, show_weight = excluded.show_weight,
    show_water = excluded.show_water, show_steps = excluded.show_steps,
    show_sleep = excluded.show_sleep, personalization = excluded.personalization,
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
  where excluded.updated_at > profiles.updated_at;
$$;

create or replace function public.sync_upsert_kitchen(rows jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into kitchen
  select * from jsonb_populate_recordset(null::kitchen, rows)
  on conflict (user_id) do update set
    katori_ml = excluded.katori_ml, roti_g = excluded.roti_g,
    oil_bottle_ml = excluded.oil_bottle_ml, oil_bottle_days = excluded.oil_bottle_days,
    household_size = excluded.household_size, chai_sugar_tsp = excluded.chai_sugar_tsp,
    chai_milk = excluded.chai_milk, coffee_sugar_tsp = excluded.coffee_sugar_tsp,
    coffee_milk = excluded.coffee_milk, is_assumed = excluded.is_assumed,
    updated_at = excluded.updated_at
  where excluded.updated_at > kitchen.updated_at;
$$;
