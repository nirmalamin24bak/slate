# Adding dishes — the workflow

The dish table is the moat and the schedule: 50 of the 400–600 dishes exist. `MASTER.md` says
it is **not delegable to a model**, and that constraint is the point — a generated table makes
Slate MyFitnessPal with better typography. This page is how a dish gets in without that
happening, and what the machine checks on your behalf so review time goes to the numbers
rather than the plumbing.

## The shape of one dish

`supabase/seed/dishes.draft.json`, one object per dish:

```json
{
  "id": "dish_dal_toor",
  "name": "Toor Dal",
  "region": null,
  "aliases": ["dal", "tur dal", "arhar dal", "toor dal"],
  "default_unit": "katori",
  "default_qty": 1,
  "is_home_cookable": true,
  "cooking_fat_ml": 4,
  "serving_g": 200,
  "ingredients": [
    { "ref": "lentil_pigeon_toor", "grams": 30 },
    { "ref": "tomato", "grams": 15 }
  ],
  "notes": "Homestyle dal with ghee tadka; 30g raw dal makes one 200ml katori cooked. …"
}
```

Field by field, in the order they cause mistakes:

- **`ingredients[].grams` is the RAW basis.** What goes in the pan, not what lands in the
  bowl. 30 g of dry toor. This is what keeps every number's lineage back to an IFCT row.
- **`serving_g` is what one default portion WEIGHS SERVED.** 30 g of dry dal becomes a 200 ml
  katori, so `serving_g: 200`. Getting this wrong by omission is how the engine came to
  compute a katori of plain rice at 713 kcal — the two bases were conflated. Rule:
  - cooked from dry, or diluted (dal, rice, khichdi, sambar, chaas) → **declare it**;
  - the ingredients already are the thing on the plate (a banana, a roti, curd) → **`null`**,
    with a note saying why. The generator refuses a volume-unit dish that decides neither.
- **`cooking_fat_ml`** is the baseline fat for the portion, and it must NOT also appear as an
  ingredient — the engine adds it, so listing both double-counts. Exception, already used:
  deep-fried items (samosa, sev, bhel) carry absorbed oil as an _ingredient_, because absorbed
  oil is not the katori-distributed cooking oil the kitchen calibration models.
- **`aliases`** is what the resolver matches. Include the Hinglish a Vadodara user types.
  No two dishes may claim the same alias — the resolver has no way to choose, and the user
  sees a different number for the same words.
- **`ref`** must exist in `scripts/ifct/ref-map.json`, which maps it to an imported ingredient
  id. A new ingredient means adding to the ref map (and, if IFCT has no row for it, to
  `scripts/ifct/supplemental.json` with lineage for the value).

## The band — the review step, in a file

Every dish needs an entry in `supabase/seed/dish-bands.json`:

```json
"dish_dal_toor": [110, 166]
```

`test/dish-bands.test.ts` computes the recipe through the **real engine** over the **real IFCT
rows in the generated seed**, and fails if it lands outside. A dish with no band fails too.
That is deliberate: it is the one thing a model cannot supply for you. Writing the band is
saying _"a katori of dal is about 140 kcal and I will stand behind that"_.

Today's bands are **regression pins** — ±20% around values verified by hand on 13 Jul 2026,
not independent review. Replacing a pin with a band from a published source is an upgrade;
note the source in the file when you do.

## Adding a batch

1. Draft the recipes into `dishes.draft.json`. Keep batches small enough to review in one
   sitting — 10–20 dishes. Regional variants are separate dishes with their own `region`
   (poha Gujarati vs Indori already are), not an averaged compromise.
2. Add any new ingredient refs to `scripts/ifct/ref-map.json`.
3. Add a band per dish to `dish-bands.json`.
4. Regenerate and check:

   ```
   node scripts/seed-reference.mjs      # writes 02_dishes.sql + 03_exercises.sql
   npx vitest run test/dish-bands.test.ts test/seed-reference.test.ts
   ```

5. Commit the json, the bands, **and** the generated SQL together. CI runs
   `node scripts/seed-reference.mjs --check` and fails if the committed SQL doesn't match the
   json, so they can never drift.

## What the machine already checks

Structural failures never reach review:

- every ingredient ref maps to an imported ingredient id;
- no duplicate dish ids, no ingredient listed twice in one recipe (the primary key would
  silently collapse them), no alias claimed by two dishes;
- positive grams and `default_qty`; a volume-unit dish has decided `serving_g`;
- exercise MET inside 1–23, unit is `minutes` or `km`, `is_ambulatory` is a real boolean —
  it drives the steps double-count rule;
- the recipe lands inside its band, computed through the engine, not by hand.

## How it reaches a database

```
scripts/ifct/data/…            → scripts/ifct-import.mjs   → supabase/seed/01_ingredients.sql
supabase/seed/dishes.draft.json → scripts/seed-reference.mjs → supabase/seed/02_dishes.sql
supabase/seed/exercises.draft.json                          → supabase/seed/03_exercises.sql
```

The deploy job applies all three in name order on merge to `main`, idempotently, each inside
one transaction (`psql --single-transaction -v ON_ERROR_STOP=1`). Re-applying is safe and is
how a corrected recipe ships: the upsert updates, and ingredients a recipe no longer contains
are deleted for the dishes in that file.

**Not yet verified against a live Postgres** — nobody has applied 02/03 to a real database.
Apply to a branch DB before the first production run. `SUPABASE_DB_URL` must be set as a repo
secret or the deploy step fails.

## Which dishes next

Ordered by how often a Vadodara user hits `unresolved` without them, not alphabetically:
the remaining everyday Gujarati home table (undhiyu, dal dhokli, handvo, muthiya, sev tameta,
kadhi), the North Indian restaurant staples already reachable by alias (paneer tikka, dal
makhani, naan, kulcha), the South Indian breakfast set (uttapam, pongal, upma variants,
rasam), street food (pani puri, dabeli, frankie, momos), and packaged/chain items people type
by brand. Every one of those is a line someone in the target audience types in their first
week.
