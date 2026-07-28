-- Audit C7 — bound what one sync push can be.
--
-- sync_upsert_entries(rows jsonb) populated a recordset from a client-supplied
-- JSON array with no length bound, and nothing capped how many rows a user may
-- own. RLS enforces OWNERSHIP; it has never enforced VOLUME. Accounts are free,
-- unlimited and anonymous, so the cost of finding out is nothing:
--
--   one authenticated caller POSTs a single RPC carrying five million entry
--   rows. It is one statement, in one transaction, expanding jsonb in memory on
--   the primary and holding locks while it does. Repeat across a hundred free
--   accounts.
--
-- Two bounds, both cheap enough to sit in the write path.
--
-- PAYLOAD SIZE. The client batches from listDirtyEntries — a device pushes the
-- rows it actually changed, which is a handful per tick and a day's backlog at
-- worst. 500 is far above any honest push and far below anything that hurts.
-- Exceeding it RAISES rather than silently truncating: a client that legitimately
-- has more to send must page, and a caller that is not our client should be told
-- no rather than half-succeed.
--
-- ROWS PER DAY. A per-user total would need a count over the whole table on
-- every push, which is exactly the cost we are trying to avoid. The per-DAY cap
-- is scoped to the log_dates actually present in the payload, so the count is an
-- index range read over one day of one user, and it is also the bound with
-- product meaning: nobody writes 500 journal lines in a day. spec/02 is a text
-- editor with one line per thing eaten.
--
-- Residual, stated honestly: this does not cap lifetime rows. A patient attacker
-- can still write 500 rows/day/account forever. Closing that needs a per-user
-- quota counter, which is a write on every push; the payload bound plus this is
-- what is worth paying for today. Revisit if abuse ever shows up in the numbers
-- (which needs audit C8 first).

create or replace function public.sync_guard(rows jsonb, p_table text)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  c_max_rows constant integer := 500;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'sync payload for % must be a json array', p_table
      using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(rows) > c_max_rows then
    raise exception 'sync payload for % has % rows, limit is %',
      p_table, jsonb_array_length(rows), c_max_rows
      using errcode = 'program_limit_exceeded';
  end if;
end;
$$;

-- Callable by the client roles: it is a guard the sync RPCs invoke, it reads
-- nothing, and the sync RPCs are SECURITY INVOKER so they run as the caller.
grant execute on function public.sync_guard(jsonb, text) to authenticated;

-- Entries carry the per-day cap as well; the other three tables are one row per
-- user (profiles, kitchen) or one per day (weights) by construction.
create or replace function public.sync_upsert_entries(rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  c_max_per_day constant integer := 500;
  v_day     date;
  v_existing integer;
  v_incoming integer;
begin
  perform sync_guard(rows, 'entries');

  -- One bounded count per distinct day in the payload. LIMIT makes it stop at
  -- the cap instead of counting a large day to the end.
  for v_day, v_incoming in
    select (r->>'log_date')::date, count(*)
    from jsonb_array_elements(rows) r
    where r->>'log_date' is not null
    group by 1
  loop
    select count(*) into v_existing
    from (
      select 1 from entries
      where user_id = auth.uid() and log_date = v_day and deleted_at is null
      limit c_max_per_day + 1
    ) capped;
    if v_existing + v_incoming > c_max_per_day then
      raise exception 'entries for % would exceed the % per-day limit', v_day, c_max_per_day
        using errcode = 'program_limit_exceeded';
    end if;
  end loop;

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
end;
$$;

create or replace function public.sync_upsert_weights(rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform sync_guard(rows, 'weights');
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
end;
$$;

create or replace function public.sync_upsert_profiles(rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform sync_guard(rows, 'profiles');
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
end;
$$;

create or replace function public.sync_upsert_kitchen(rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform sync_guard(rows, 'kitchen');
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
    updated_at = excluded.updated_at;
end;
$$;
