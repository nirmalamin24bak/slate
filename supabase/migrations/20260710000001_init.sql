-- 0001 — full schema + RLS + indexes (spec/04-DATA-MODEL.md).
-- Sync is built into this first migration: UUID PKs (client-generated),
-- updated_at for last-write-wins, deleted_at tombstones.
-- RLS is enabled on EVERY table in the migration that creates it. Never later.

-- ---------------------------------------------------------------------------
-- Reference tables: global, select-only to users. Writes happen via service
-- role (imports, Edge Functions) which bypasses RLS.
-- ---------------------------------------------------------------------------

create table ingredients (
  id            text primary key,               -- 'IFCT_A001'
  name          text not null,
  name_hi       text,                           -- devanagari, for the resolver
  kcal_100g     numeric not null,
  protein_100g  numeric not null,
  carbs_100g    numeric not null,
  fat_100g      numeric not null,
  fiber_100g    numeric,
  sugar_100g    numeric,
  source        text not null default 'IFCT2017'
);

alter table ingredients enable row level security;
create policy "reference read" on ingredients
  for select to authenticated using (true);

create table dishes (
  id                text primary key,           -- 'dish_poha_gujarati'
  name              text not null,
  region            text,                       -- 'gujarati' | 'indori' | null
  aliases           text[],
  default_unit      text not null,              -- 'katori' | 'plate' | 'piece' | 'g'
  default_qty       numeric not null,
  is_home_cookable  boolean not null,
  cooking_fat_ml    numeric                     -- baseline, overridden by calibration
);

alter table dishes enable row level security;
create policy "reference read" on dishes
  for select to authenticated using (true);

create table dish_ingredients (
  dish_id        text not null references dishes(id),
  ingredient_id  text not null references ingredients(id),
  grams          numeric not null,
  primary key (dish_id, ingredient_id)
);

alter table dish_ingredients enable row level security;
create policy "reference read" on dish_ingredients
  for select to authenticated using (true);

create table exercises (
  id             text primary key,
  name           text not null,
  aliases        text[],
  met            numeric not null,
  unit           text not null,                 -- 'minutes' | 'km'
  is_ambulatory  boolean not null default false -- walk/jog/run/hike/treadmill
);

alter table exercises enable row level security;
create policy "reference read" on exercises
  for select to authenticated using (true);

create table packaged_foods (
  barcode       text primary key,
  brand         text,
  name          text,
  kcal_100g     numeric,
  protein_100g  numeric,
  carbs_100g    numeric,
  fat_100g      numeric,
  fiber_100g    numeric,
  sugar_100g    numeric
);

alter table packaged_foods enable row level security;
create policy "reference read" on packaged_foods
  for select to authenticated using (true);

-- Global, deliberately NO user_id (DPDP: raw text is never attributable here).
-- Writes only via the cache-write Edge Function with the service role.
create table resolution_cache (
  normalized_text  text primary key,            -- '2 roti'
  intent           text not null,
  resolved_ref     text,
  qty              numeric,
  unit             text,
  hit_count        integer not null default 1,
  confidence       numeric
);

alter table resolution_cache enable row level security;
create policy "reference read" on resolution_cache
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- User tables: RLS "own rows" on every one, in this same migration.
-- ---------------------------------------------------------------------------

create table profiles (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  -- body
  dob                date,
  sex                text check (sex in ('male', 'female')),
  height_cm          numeric,
  weight_kg          numeric,
  weight_is_assumed  boolean not null default true,
  -- goals: calorie_goal is nullable with NO default — Slate never picks a goal.
  -- The 1200 floor is guardrail #4, enforced in UI and here in depth.
  calorie_goal       integer check (calorie_goal is null or calorie_goal >= 1200),
  protein_goal_g     integer,
  carbs_goal_g       integer,
  fat_goal_g         integer,
  -- display
  unit_height        text not null default 'cm' check (unit_height in ('cm', 'ftin')),
  hide_calories      boolean not null default false,
  show_macros        boolean not null default true,
  show_fiber_sugar   boolean not null default false,
  show_exercise      boolean not null default false,
  show_weight        boolean not null default false,
  show_water         boolean not null default false,
  show_steps         boolean not null default false,
  show_sleep         boolean not null default false,
  -- resolver
  personalization    text,
  -- sync
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

alter table profiles enable row level security;
create policy "own rows" on profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table kitchen (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  katori_ml         numeric not null default 200,
  roti_g            numeric not null default 35,
  oil_bottle_ml     numeric not null default 1000,
  oil_bottle_days   integer not null default 30,
  household_size    integer not null default 4,
  chai_sugar_tsp    numeric not null default 1,
  chai_milk         text not null default 'toned' check (chai_milk in ('none', 'toned', 'full')),
  coffee_sugar_tsp  numeric not null default 1,
  coffee_milk       text not null default 'toned' check (coffee_milk in ('none', 'toned', 'full', 'decoction')),
  is_assumed        boolean not null default true,
  -- sync
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

alter table kitchen enable row level security;
create policy "own rows" on kitchen
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  log_date       date not null,                 -- the day it belongs to, not created_at
  position       integer not null,              -- line order within the day
  raw_text       text not null,                 -- exactly what the user typed
  nickname       text,                          -- set → this is a saved food
  intent         text not null check (intent in ('food', 'exercise', 'weight', 'water', 'steps', 'sleep', 'unresolved')),
  status         text not null check (status in ('resolving', 'resolved', 'unresolved')),
  -- resolution
  resolved_ref   text,
  qty            numeric,
  unit           text,
  context        text check (context in ('home', 'outside')),
  -- computed nutrition, denormalised at write time
  kcal           numeric,                       -- negative for exercise & steps; null for water/sleep
  protein_g      numeric,
  carbs_g        numeric,
  fat_g          numeric,
  fiber_g        numeric,
  sugar_g        numeric,
  -- non-nutrition intents
  water_ml       numeric,
  step_count     integer,
  sleep_minutes  integer,
  is_included    boolean not null default false, -- counted-elsewhere (steps vs ambulatory)
  -- provenance
  calc_version   text not null,
  was_calibrated boolean not null default false,
  -- sync
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

alter table entries enable row level security;
create policy "own rows" on entries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table weights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  log_date    date not null,
  weight_kg   numeric not null,
  source      text not null check (source in ('journal', 'health', 'onboarding')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (user_id, log_date)
);

alter table weights enable row level security;
create policy "own rows" on weights
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table custom_dishes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,                  -- "Mummy's dal"
  default_unit  text not null,
  default_qty   numeric not null,
  kcal          numeric,                        -- per default_qty
  protein_g     numeric,
  carbs_g       numeric,
  fat_g         numeric,
  fiber_g       numeric,
  sugar_g       numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

alter table custom_dishes enable row level security;
create policy "own rows" on custom_dishes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table custom_dish_ingredients (
  custom_dish_id  uuid not null references custom_dishes(id) on delete cascade,
  ingredient_id   text not null references ingredients(id),
  grams           numeric not null,
  primary key (custom_dish_id, ingredient_id)
);

-- No user_id column: ownership flows through the parent custom dish.
alter table custom_dish_ingredients enable row level security;
create policy "own rows via dish" on custom_dish_ingredients
  for all to authenticated
  using (exists (
    select 1 from custom_dishes cd
    where cd.id = custom_dish_id and cd.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from custom_dishes cd
    where cd.id = custom_dish_id and cd.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Indexes (spec/04)
-- ---------------------------------------------------------------------------

create index on entries (user_id, log_date, position) where deleted_at is null;
create index on entries (user_id, updated_at);
create index on weights (user_id, log_date desc);
create index on dishes using gin (aliases);
