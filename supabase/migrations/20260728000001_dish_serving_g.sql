-- dishes.serving_g — the served weight of one default portion.
--
-- Recipes are written on the raw basis, which is the honest lineage: dal is
-- 30 g of toor, rice is 50 g of milled rice. But the katori it arrives in
-- holds 200 ml. The engine was scaling a served weight against the raw recipe
-- total, so one katori of plain rice computed as 713 kcal and one katori of
-- toor dal as 454, against spec/06's stated 100-150 for a katori of dal.
--
-- Null keeps the old meaning — recipe total IS the served weight — which is
-- correct for everything countable (a banana, a roti, a piece of dhokla).
-- Only wet/cooked-from-dry dishes need a value.
--
-- Forward-only, additive, no backfill needed: the seed (02_dishes.sql) carries
-- the values and is idempotent.

alter table dishes add column if not exists serving_g numeric;

comment on column dishes.serving_g is
  'Served weight in grams of default_qty x default_unit at the median kitchen (200 ml katori). Null when the recipe total already is the served weight.';
