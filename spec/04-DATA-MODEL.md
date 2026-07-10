# 04 — Data Model

Postgres on Supabase, region `ap-south-1` (Mumbai). Data residency matters under DPDP.

Local mirror in `expo-sqlite` is the **read source**. Supabase is **truth**.

---

## Sync contract

Every user-owned table carries:

```sql
id           uuid primary key default gen_random_uuid()
user_id      uuid not null references auth.users(id) on delete cascade
created_at   timestamptz not null default now()
updated_at   timestamptz not null default now()
deleted_at   timestamptz                                -- soft delete
```

- **UUID primary keys**, generated client-side, so an offline entry has its real ID the moment it exists.
- **Last-write-wins** on `updated_at`. A calorie journal has no merge conflicts worth solving.
- **Soft delete.** Sync needs tombstones.
- Pull: `where updated_at > :last_sync`. Push: dirty rows from SQLite.

Build this from the first migration. Retrofitting sync is a rewrite.

---

## Reference tables (global, read-only to users)

### `ingredients`
IFCT 2017. ~528 rows. The ground truth.

```sql
id                text primary key        -- 'IFCT_A001'
name              text not null
name_hi           text                    -- devanagari, for the resolver's benefit
kcal_100g         numeric not null
protein_100g      numeric not null
carbs_100g        numeric not null
fat_100g          numeric not null
fiber_100g        numeric
sugar_100g        numeric
source            text not null default 'IFCT2017'
```

### `dishes`
Our work. 400–600 rows at launch. Composed from `ingredients` — never hand-typed calories.

```sql
id                text primary key        -- 'dish_poha_gujarati'
name              text not null           -- 'Poha'
region            text                    -- 'gujarati' | 'indori' | null
aliases           text[]                  -- {'pohe','aval','chivda'}
default_unit      text not null           -- 'katori' | 'plate' | 'piece' | 'g'
default_qty       numeric not null
is_home_cookable  boolean not null        -- does kitchen calibration apply?
cooking_fat_ml    numeric                 -- baseline, overridden by calibration
```

### `dish_ingredients`
The lineage. This is why we can defend any number.

```sql
dish_id           text references dishes(id)
ingredient_id     text references ingredients(id)
grams             numeric not null
primary key (dish_id, ingredient_id)
```

### `exercises`
Compendium of Physical Activities. MET values.

```sql
id                text primary key
name              text not null
aliases           text[]
met               numeric not null
unit              text not null           -- 'minutes' | 'km'
is_ambulatory     boolean not null default false  -- walk/jog/run/hike/treadmill
```

`is_ambulatory` exists so the engine can refuse to count a walk twice when the user also logged their steps. See `06-NUTRITION-ENGINE.md`.

### `packaged_foods`
Barcode lookups. Seeded from Open Food Facts, corrected by us.

```sql
barcode           text primary key
brand             text
name              text
kcal_100g         numeric
protein_100g      numeric
carbs_100g        numeric
fat_100g          numeric
fiber_100g        numeric
sugar_100g        numeric
```

---

## User tables

### `profiles`

```sql
user_id           uuid primary key references auth.users(id) on delete cascade
-- body
dob               date
sex               text                    -- 'male' | 'female' | null
height_cm         numeric
weight_kg         numeric
weight_is_assumed boolean not null default true
-- goals
calorie_goal      integer
protein_goal_g    integer
carbs_goal_g      integer
fat_goal_g        integer
-- display
unit_height       text not null default 'cm'    -- 'cm' | 'ftin'
hide_calories     boolean not null default false
show_macros       boolean not null default true
show_fiber_sugar  boolean not null default false
show_exercise     boolean not null default false
show_weight       boolean not null default false
show_water        boolean not null default false
show_steps        boolean not null default false
show_sleep        boolean not null default false
-- resolver
personalization   text                    -- free-text, bounded. see 05.
```

`calorie_goal` is **nullable and has no default**. Slate never picks a goal.

### `kitchen`
The moat.

```sql
user_id           uuid primary key references auth.users(id) on delete cascade
katori_ml         numeric not null default 200
roti_g            numeric not null default 35
oil_bottle_ml     numeric not null default 1000
oil_bottle_days   integer not null default 30
household_size    integer not null default 4
chai_sugar_tsp    numeric not null default 1
chai_milk         text not null default 'toned'    -- 'none'|'toned'|'full'
coffee_sugar_tsp  numeric not null default 1
coffee_milk       text not null default 'toned'    -- 'none'|'toned'|'full'|'decoction'
is_assumed        boolean not null default true
```

Derived, never stored:
```
daily_oil_ml_per_person = oil_bottle_ml / oil_bottle_days / household_size
```

### `entries`
One row per journal line.

```sql
id                uuid primary key
user_id           uuid not null
log_date          date not null           -- the day it belongs to, not created_at
position          integer not null        -- line order within the day
raw_text          text not null           -- exactly what the user typed
nickname          text                    -- set → this is a saved food
intent            text not null           -- 'food'|'exercise'|'weight'|'water'|'steps'|'sleep'|'unresolved'
status            text not null           -- 'resolving' | 'resolved' | 'unresolved'
-- resolution
resolved_ref      text                    -- dish_id | exercise_id | barcode. null for weight/water/steps/sleep
qty               numeric
unit              text
context           text                    -- 'home' | 'outside' | null
-- computed nutrition, denormalised at write time
kcal              numeric                 -- negative for exercise & steps; null for water/sleep
protein_g         numeric
carbs_g           numeric
fat_g             numeric
fiber_g           numeric
sugar_g           numeric
-- non-nutrition intents
water_ml          numeric                 -- water only
step_count        integer                 -- steps only
sleep_minutes     integer                 -- sleep only, nullable even when intent='sleep'
is_included       boolean not null default false  -- counted-elsewhere (steps vs ambulatory exercise)
-- provenance
calc_version      text not null           -- bump when the engine changes
was_calibrated    boolean not null default false
created_at, updated_at, deleted_at
```

Nutrition is **denormalised at write time**. If we later fix a dish recipe, historical entries do not silently change. `calc_version` records which engine produced them. A user's June is not rewritten by a July bugfix.

### `weights`

```sql
id, user_id
log_date          date not null
weight_kg         numeric not null
source            text not null           -- 'journal' | 'health' | 'onboarding'
unique (user_id, log_date)
```

### `custom_dishes` *(Plus)*

```sql
id                uuid primary key
user_id           uuid not null
name              text not null           -- "Mummy's dal"
default_unit      text not null
default_qty       numeric not null
kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g   -- per default_qty
```

Composed the same way as `dishes`, via a `custom_dish_ingredients` join. Every custom dish quietly improves our understanding of what people actually eat.

### `resolution_cache`
Global, not user-scoped. This is what keeps the LLM bill near zero.

```sql
normalized_text   text primary key        -- '2 roti'
intent            text not null
resolved_ref      text
qty               numeric
unit              text
hit_count         integer not null default 1
confidence        numeric
```

"2 roti" will be typed ten million times. After a few thousand users the LLM barely fires.

---

## RLS

Enabled on **every** user table, in the same migration that creates it.

```sql
alter table entries enable row level security;

create policy "own rows" on entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Reference tables (`ingredients`, `dishes`, `exercises`, `packaged_foods`, `resolution_cache`): `select` granted to `authenticated`, no `insert`/`update`/`delete`.

`resolution_cache` writes go through an Edge Function with the service role. Never from the client.

---

## Indexes

```sql
create index on entries (user_id, log_date, position) where deleted_at is null;
create index on entries (user_id, updated_at);
create index on weights (user_id, log_date desc);
create index on dishes using gin (aliases);
```
