// Local SQLite schema — the on-device read source (spec/04). Supabase is
// truth; every user table here mirrors its Postgres twin plus one local-only
// `dirty` flag for push sync. Reference tables mirror read-only rows pulled
// from Supabase. Versioned by PRAGMA user_version.

import type { SqlAdapter } from './adapter';

// One migration per released schema shape. Never edit a shipped entry —
// append. Same discipline as supabase/migrations.
const MIGRATIONS: readonly string[][] = [
  [
    // --- user tables (spec/04, snake_case kept identical to Postgres) ---
    `CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      log_date TEXT NOT NULL,
      position INTEGER NOT NULL,
      raw_text TEXT NOT NULL,
      nickname TEXT,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      resolved_ref TEXT,
      qty REAL,
      unit TEXT,
      context TEXT,
      kcal REAL,
      protein_g REAL,
      carbs_g REAL,
      fat_g REAL,
      fiber_g REAL,
      sugar_g REAL,
      water_ml REAL,
      step_count INTEGER,
      sleep_minutes INTEGER,
      is_included INTEGER NOT NULL DEFAULT 0,
      calc_version TEXT NOT NULL,
      was_calibrated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      retryable INTEGER NOT NULL DEFAULT 0,
      dirty INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX entries_day ON entries (user_id, log_date, position)`,
    `CREATE INDEX entries_dirty ON entries (dirty)`,
    `CREATE TABLE weights (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      log_date TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 1,
      UNIQUE (user_id, log_date)
    )`,
    `CREATE TABLE profiles (
      user_id TEXT PRIMARY KEY,
      dob TEXT,
      sex TEXT,
      height_cm REAL,
      weight_kg REAL,
      weight_is_assumed INTEGER NOT NULL DEFAULT 1,
      calorie_goal INTEGER,
      protein_goal_g INTEGER,
      carbs_goal_g INTEGER,
      fat_goal_g INTEGER,
      unit_height TEXT NOT NULL DEFAULT 'cm',
      hide_calories INTEGER NOT NULL DEFAULT 0,
      show_macros INTEGER NOT NULL DEFAULT 1,
      show_fiber_sugar INTEGER NOT NULL DEFAULT 0,
      show_exercise INTEGER NOT NULL DEFAULT 0,
      show_weight INTEGER NOT NULL DEFAULT 0,
      show_water INTEGER NOT NULL DEFAULT 0,
      show_steps INTEGER NOT NULL DEFAULT 0,
      show_sleep INTEGER NOT NULL DEFAULT 0,
      personalization TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE kitchen (
      user_id TEXT PRIMARY KEY,
      katori_ml REAL NOT NULL DEFAULT 200,
      roti_g REAL NOT NULL DEFAULT 35,
      oil_bottle_ml REAL NOT NULL DEFAULT 1000,
      oil_bottle_days INTEGER NOT NULL DEFAULT 30,
      household_size INTEGER NOT NULL DEFAULT 4,
      chai_sugar_tsp REAL NOT NULL DEFAULT 1,
      chai_milk TEXT NOT NULL DEFAULT 'toned',
      coffee_sugar_tsp REAL NOT NULL DEFAULT 1,
      coffee_milk TEXT NOT NULL DEFAULT 'toned',
      is_assumed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 1
    )`,
    // --- global resolution cache mirror (no user_id, by design — spec/04) ---
    `CREATE TABLE resolution_cache (
      normalized_text TEXT PRIMARY KEY,
      intent TEXT NOT NULL,
      resolved_ref TEXT,
      qty REAL,
      unit TEXT,
      confidence REAL NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1
    )`,
    // --- reference mirrors (read-only rows pulled from Supabase) ---
    `CREATE TABLE ingredients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kcal_100g REAL NOT NULL,
      protein_100g REAL NOT NULL,
      carbs_100g REAL NOT NULL,
      fat_100g REAL NOT NULL,
      fiber_100g REAL,
      sugar_100g REAL
    )`,
    `CREATE TABLE dishes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      default_unit TEXT NOT NULL,
      default_qty REAL NOT NULL,
      is_home_cookable INTEGER NOT NULL,
      cooking_fat_ml REAL
    )`,
    `CREATE TABLE dish_ingredients (
      dish_id TEXT NOT NULL,
      ingredient_id TEXT NOT NULL,
      grams REAL NOT NULL,
      PRIMARY KEY (dish_id, ingredient_id)
    )`,
    `CREATE TABLE exercises (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      met REAL NOT NULL,
      unit TEXT NOT NULL,
      is_ambulatory INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE packaged_foods (
      barcode TEXT PRIMARY KEY,
      brand TEXT,
      name TEXT,
      kcal_100g REAL,
      protein_100g REAL,
      carbs_100g REAL,
      fat_100g REAL,
      fiber_100g REAL,
      sugar_100g REAL
    )`,
    // --- local bookkeeping ---
    `CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ],
  [
    // v2 — dishes.serving_g. The served weight of one default portion, which
    // is NOT the recipe's raw-ingredient total for anything cooked from dry
    // (50 g of rice becomes a 200 ml katori). Mirrors migration
    // 20260728000001. Null = the two coincide.
    `ALTER TABLE dishes ADD COLUMN serving_g REAL`,
  ],
  [
    // v3 — resolution_cache.last_hit_at. The mirror had no recency signal and
    // no bound, so it grew for the life of the install (audit). Eviction needs
    // to know what is actually being used, not just what was written: a phrase
    // typed once in March should go before "2 roti".
    `ALTER TABLE resolution_cache ADD COLUMN last_hit_at TEXT`,
    `CREATE INDEX resolution_cache_evict ON resolution_cache (hit_count, last_hit_at)`,
  ],
];

export async function migrate(adapter: SqlAdapter): Promise<void> {
  const row = await adapter.get<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const statements = MIGRATIONS[v];
    if (!statements) continue;
    for (const sql of statements) await adapter.run(sql);
    // PRAGMA doesn't take bind params; v+1 is a loop integer, not user input.
    await adapter.run(`PRAGMA user_version = ${v + 1}`);
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
