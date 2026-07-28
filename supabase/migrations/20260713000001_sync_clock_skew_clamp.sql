-- Audit D1 — bound client clock skew on the sync-upsert RPCs.
--
-- updated_at is generated on the client (store.ts) and is the SOLE last-write-
-- wins tiebreaker, in both the push guard (sync_upsert_*, migration ...0006:
-- `where excluded.updated_at > x.updated_at`) and the down-sync merge
-- (pullMerge*: `excluded.updated_at > local.updated_at`). A device with a fast
-- clock therefore wins every conflict regardless of true order — a device set
-- a day ahead makes its writes permanently unbeatable, silently eating every
-- genuinely-newer edit from other devices.
--
-- Full fix is a hybrid logical clock (server-authoritative ordering), a large
-- change touching every write path. The bounded, low-risk fix that kills the
-- attack: clamp each incoming row's updated_at to at most now() + a small
-- tolerance at the server write boundary. A device can no longer claim a
-- timestamp far in the future; a plausibly-skewed request (network latency,
-- seconds of drift) is untouched. Backward-skewed devices simply lose more
-- conflicts, which is correct — by wall-clock their edit really is older.
--
-- The stored updated_at is then honest server-bounded time, so the existing `>`
-- guards on both push and pull keep working, now against a value no client can
-- inflate. security invoker is retained: RLS still scopes writes to auth.uid().

-- Tolerance for legitimate latency + minor drift. Not a day — a minute.
create or replace function public.clamp_sync_ts(client_ts timestamptz)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  -- A null client timestamp (shouldn't happen; defensive) falls back to now().
  select least(coalesce(client_ts, now()), now() + interval '60 seconds');
$$;

-- Each RPC populates the recordset, projects a clamped updated_at in the SELECT
-- list, then upserts guarded by that clamped value. Column order in the SELECT
-- matches each table's definition (jsonb_populate_recordset maps by name, so we
-- can name columns explicitly and drop the fragile `select *` ordinal match).

create or replace function public.sync_upsert_entries(rows jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into entries
  select
    id, user_id, log_date, position, raw_text, nickname, intent, status,
    resolved_ref, qty, unit, context, kcal, protein_g, carbs_g, fat_g,
    fiber_g, sugar_g, water_ml, step_count, sleep_minutes, is_included,
    calc_version, was_calibrated, created_at,
    clamp_sync_ts(updated_at) as updated_at,
    deleted_at
  from jsonb_populate_recordset(null::entries, rows)
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
  select
    id, user_id, log_date, weight_kg, source, created_at,
    clamp_sync_ts(updated_at) as updated_at,
    deleted_at
  from jsonb_populate_recordset(null::weights, rows)
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
  select
    user_id, dob, sex, height_cm, weight_kg, weight_is_assumed, calorie_goal,
    protein_goal_g, carbs_goal_g, fat_goal_g, unit_height, hide_calories,
    show_macros, show_fiber_sugar, show_exercise, show_weight, show_water,
    show_steps, show_sleep, personalization, created_at,
    clamp_sync_ts(updated_at) as updated_at,
    deleted_at
  from jsonb_populate_recordset(null::profiles, rows)
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
  select
    user_id, katori_ml, roti_g, oil_bottle_ml, oil_bottle_days, household_size,
    chai_sugar_tsp, chai_milk, coffee_sugar_tsp, coffee_milk, is_assumed,
    created_at,
    clamp_sync_ts(updated_at) as updated_at,
    deleted_at
  from jsonb_populate_recordset(null::kitchen, rows)
  on conflict (user_id) do update set
    katori_ml = excluded.katori_ml, roti_g = excluded.roti_g,
    oil_bottle_ml = excluded.oil_bottle_ml, oil_bottle_days = excluded.oil_bottle_days,
    household_size = excluded.household_size, chai_sugar_tsp = excluded.chai_sugar_tsp,
    chai_milk = excluded.chai_milk, coffee_sugar_tsp = excluded.coffee_sugar_tsp,
    coffee_milk = excluded.coffee_milk, is_assumed = excluded.is_assumed,
    updated_at = excluded.updated_at
  where excluded.updated_at > kitchen.updated_at;
$$;
