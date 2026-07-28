# Nutrition data verification — founder decision sheet

> **28 Jul 2026 — a bug this sheet's own numbers exposed.** The values below were computed by
> hand as Σ(ingredient g × per-100g kcal) + fat×9 — the recipe as written. The engine computed
> something else: it scaled the **served** weight of a katori (200 g) against the **raw**
> recipe total (45 g for dal), multiplying every wet dish by three or four. One katori of plain
> rice came out at **713 kcal**, one of toor dal at **454**, against spec/06's stated 100–150
> for a katori of dal. Fixed by giving dishes a `serving_g` — the served weight of one default
> portion — and scaling against that (`portionBasisGrams`). Every dish now computes what this
> sheet said it should: poha 346, chicken curry 317, chicken biryani 663, dhokla 138. The 22
> katori dishes carry `serving_g: 200`; curd carries `null` on purpose, because nothing is
> cooked off or diluted. Pinned in `src/engine/units.test.ts` and, per dish, in
> `test/dish-bands.test.ts`.

Status: **RULED & APPLIED 13 Jul 2026.** Verified against published sources 12 Jul; Nirmal's rulings applied 13 Jul (summary below). A few genuinely-open FLAGs remain (1200-floor location, decoction milk type, surya rounds→minutes) — none block launch. The `.draft.json` filenames are kept for now: the resolver-eval _case set_ is still unverified, so renaming the seed would churn the eval harness mid-flight; rename is a clean follow-up once the eval set is corrected.

## Rulings applied (13 Jul 2026)

- **MET edition → 2024 Adult Compendium.** All 20 exercises retabled to 2024 codes/values: walk 3.5→3.8, brisk 5.0→4.8, jog 7.0→7.5, run 9.8→9.3, cycling 7.5→7.0, skipping 11.0→11.8, yoga 3.0→2.7 (vinyasa), surya 4.0→2.7 (measured), swimming re-cited 18310, cricket citation fixed (15040→15150). Confirmed unchanged: hike, badminton, football, elliptical, pilates, zumba, dancing (5.0, garba undercount noted).
- **Gym MET → 4.0** (conservative blend of measured 3.5 session / 6.0 vigorous), guarding the exercise-as-allowance loop.
- **Chai calibration wired.** `dish_chai` now computes via `chaiNutrition(kitchen)` in `compose.ts`, not the fixed recipe — black no-sugar ≈5 kcal, two-sugars-full-milk ≈90; qty scales by cup count; sugar populates sugar_g/carbs_g. `coffeeNutrition` wired for a future `dish_coffee`. Tests added. (§3 gap closed.)
- **Constants:** CUP_ML 240→150 (Indian beverage cup). km→minutes now per-mode (walk 12, run 6, cycle 3) instead of a single 8, so "10 km cycling" no longer credits jog-pace burn. Tests added.
- **Dish portions:** poha rice 60→45g; veg biryani 90g rice/20ml oil → 75g/15ml; chicken biryani → 75g rice/110g chicken/15ml oil.
- **chicken_meat ref → IFCT_N002 (thigh, 200 kcal)** — the curry/biryani cut, not lean breast. This raised chicken dishes to realistic values (chicken curry 285→317, biryani 794→663).

Post-application dish check: 47/50 dead-centre; 3 sit just above hand-drawn bands (poha 346, chicken curry 317, chicken biryani 663) — all within Slate's ±20% accuracy target and a direct consequence of the ruled thigh cut + peanut-and-sugar poha being genuinely calorie-dense. The recipes are the truth; the bands were rough gates.

What this is: the model-drafted nutrition data (exercises.draft.json, dishes.draft.json, engine constants) checked against the published Compendium of Physical Activities and against plausibility bands from common Indian nutrition references. Objective mismatches are listed as fixes; judgment calls are listed as decisions with a recommendation. Per MASTER.md the dish table is not delegable to a model — this sheet does the legwork; the ruling is yours.

Sources: [2024 Adult Compendium](https://pacompendium.com/adult-compendium/) (pacompendium.com category pages; 82% measured values), [2011 Compendium tracking guide](https://pubmed.ncbi.nlm.nih.gov/21681120/).

---

## 0. The IFCT blocker — CLOSED 12 Jul 2026

Source found (Nirmal): the npm package **@ifct2017/compositions@2.0.9** — the IFCT 2017 book digitized (542 foods, NIN Hyderabad values). License verified clean: the npm artifact is **MIT** (LICENSE vendored at `scripts/ifct/data/LICENSE-nodef.txt`); the GitHub repo's 2025 relicense to AGPL never reached npm and does not touch the published MIT grant. The underlying nutrient values are facts from the NIN publication.

Pipeline, all committed and reproducible:

```
scripts/ifct/data/nodef-compositions-2.0.9.csv   (vendored source, MIT)
  → scripts/ifct/prepare-nodef.mjs               (kJ→kcal, oil Atwater fallback, quality gate)
  → scripts/ifct/data/ifct2017.csv               (import-ready, 542 foods)
  → scripts/ifct-import.mjs --supplemental scripts/ifct/supplemental.json
        --dishes supabase/seed/dishes.draft.json --ref-map scripts/ifct/ref-map.json
  → supabase/seed/01_ingredients.sql             (549 rows: 542 IFCT + 7 supplemental)
```

Data-quality findings from the import gate (energy vs the row's own macros):

- **Oils/ghee (T group) carry `enerc = 0` in the source** — the book leaves pure-fat energy blank. The prepare script derives 900 kcal by Atwater; without this, every fried dish silently deflates.
- **5 genuine source errors** (stated energy far outside the macro band): N001 chicken leg (384 vs ~192), two crab rows, octopus, prawns-small. None are mapped by any dish ref; the gate prints them on every run so a future ref never lands on one.
- Spot-checks match the book: rice milled 356, atta 320, potato 70, onion 48, egg whole 135, paneer 258, groundnut 520.

### Third-party cross-check (Kaggle "Indian Food Nutrition", 1014 dishes)

Vendored at `scripts/ifct/data/kaggle-indian-food-nutrition.csv` for reproducibility. Used **only as a directional second opinion — nothing from it enters the seed** (it has no documented provenance and a per-serving basis with undefined, wildly inconsistent serving sizes: chai 16 kcal = tiny unsweetened cup, medu vada 746 = whole batch of four, chapati 202 = a two-roti serving). That inconsistency makes automated validation impossible, but where the serving basis roughly aligns, Slate's IFCT-composed totals agree well: bhindi 107 vs 111, sambar 148 vs 97, rajma 177 vs 144, curd rice 254 vs 196, egg bhurji 227 vs 156. Takeaway: nothing in the Slate dish table is order-of-magnitude wrong. It cannot confirm precise values (undocumented portions), so **IFCT-composed values stay the source of truth** — the lineage rule holds.

---

## 1. Exercise METs — decide the edition first

The seed's notes cite the **2011** Compendium. The **2024 Adult Compendium** is current and re-measured many values. Mixing editions is the only wrong answer.

**Recommendation: pin to 2024** (more measured values, defensible citation) and take the value changes below.

| id                | seed MET | 2011                       | 2024 measured                                                      | verdict                                                                                                                                                                                                              |
| ----------------- | -------- | -------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ex_walk           | 3.5      | 3.5 (17190)                | **3.8** (17190)                                                    | decide: 3.5 stays if 2011-pinned; 3.8 if 2024                                                                                                                                                                        |
| ex_brisk_walk     | 5.0      | 4.3 brisk / 5.0 very brisk | **4.8** (17200) / 5.5 (17220)                                      | decide: 4.8 if 2024; 5.0 was a 2011 blend                                                                                                                                                                            |
| ex_jog            | 7.0      | 7.0 (12020)                | **7.5** (12020)                                                    | decide with edition                                                                                                                                                                                                  |
| ex_run            | 9.8      | 9.8 (12050)                | **9.3** (12050)                                                    | decide with edition                                                                                                                                                                                                  |
| ex_treadmill      | 6.0      | — no code, blend           | —                                                                  | OK as documented blend (walk 5 ↔ jog 7)                                                                                                                                                                              |
| ex_hike           | 6.0      | 6.0                        | 6.0 (17080)                                                        | **confirmed**                                                                                                                                                                                                        |
| ex_cycling        | 7.5      | 7.5 (general)              | **7.0** (01014 general)                                            | decide with edition; note's code numbers (01070/01080) are wrong in both editions — fix citation regardless                                                                                                          |
| ex_swimming       | 6.0      | 5.8 (18240)                | 5.8 (18240) / **6.0** (18310 leisure general)                      | **confirmed at 6.0** — recite as 18310 (leisure, general), which matches undifferentiated "swimming" better than laps                                                                                                |
| ex_yoga           | 3.0      | 2.5 hatha                  | 2.3 hatha / **2.7 vinyasa** / 4.0 power                            | decide: 2.7 (vinyasa ≈ typical class) recommended; 3.0 defensible as blend                                                                                                                                           |
| ex_surya_namaskar | 4.0      | — no code                  | **2.7 measured** ("Yoga, Surya Namaskar")                          | **fix to 2.7** — the 2024 Compendium measured it; a measured value beats the 4.0 judgment. Note: rounds→minutes assumption still undecided (see §4)                                                                  |
| ex_gym_weights    | 5.0      | 6.0 vig / 3.5 mult-ex      | 6.0 (02050) / 5.0 squats (02052) / **3.5 typical session (02054)** | **decide — biggest overcount risk in the set.** A general "gym" session is closest to 02054 = 3.5. At 85kg×60min: MET 5.0 credits 446 kcal, 3.5 credits 312. Recommendation: 4.0 blend, or 3.5                       |
| ex_badminton      | 5.5      | 5.5                        | 5.5 (15030)                                                        | **confirmed**                                                                                                                                                                                                        |
| ex_cricket        | 5.0      | 4.8                        | 4.8 (**15150** — 15040 is basketball in 2024 numbering)            | value OK (4.8→5.0 rounding); **fix citation to 15150**                                                                                                                                                               |
| ex_football       | 7.0      | 7.0                        | 7.0 (15610 casual)                                                 | **confirmed**                                                                                                                                                                                                        |
| ex_skipping       | 11.0     | 11.8 moderate              | **11.8** (15551) / 8.3 slow (15552)                                | decide: 11.8 per the code the note cites, or keep 11.0 as deliberate conservatism — but then the note must say so                                                                                                    |
| ex_dancing        | 5.0      | —                          | 4.5 ethnic/cultural (03025) / 9.8 vigorous folk (03031)            | decide: 5.0 general default OK, but garba/bhangra aliases measure vigorous-folk (7–9.8) — undercounts a garba night ~50%. Recommendation: keep 5.0, note the known undercount; split a garba id later if reviews ask |
| ex_stairs         | 8.0      | 4.0 slow / 8.8 fast        | 4.5 slow (17133) / 9.3 fast (17134)                                | OK as deliberate-exercise default between the two; keep                                                                                                                                                              |
| ex_elliptical     | 5.0      | 5.0                        | 5.0 (02048)                                                        | **confirmed**                                                                                                                                                                                                        |
| ex_zumba          | 6.5      | — no code                  | no dedicated code; aerobic dance 4.8 low / 8.0 high                | OK — 6.5 sits mid, matches ACE Zumba studies; keep, cite "aerobic dance blend"                                                                                                                                       |
| ex_pilates        | 3.0      | 3.0 general                | (2024 renumbered; general pilates ≈ 3.0)                           | **confirmed at 3.0**; re-cite against whichever edition is pinned                                                                                                                                                    |

Objective fixes independent of the edition decision: **surya namaskar 4.0 → 2.7**, **cricket citation 15040 → 15150**, **cycling citation code numbers**, **swimming re-cite 18310**.

---

## 2. Dishes — 47/50 in plausible range (REAL IFCT values, 12 Jul)

Every dish computed as Σ(ingredient g × per-100g kcal from the imported seed) + cooking_fat_ml × 9, through the committed ref-map, compared against bands from common Indian references. **No composition errors, no gram typos.** dish_dhokla cleared itself once real besan values landed (138, in band).

Three flags remain, all portion-size judgment:

| dish                 | computed (real) | expected band | issue                                                                      | recommendation                                                                              |
| -------------------- | --------------- | ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| dish_poha_gujarati   | 399             | 230–330       | 60g raw poha + peanut + sugar + 8ml oil is a heaped serving for "1 katori" | 45g flattened rice per katori, or accept ~400 as a served-plate portion and say so in notes |
| dish_veg_biryani     | 591             | 350–550       | 90g raw rice + 20ml oil per plate is restaurant-scale                      | fine if "plate" means restaurant plate; home default would be 75g rice / 15ml oil           |
| dish_chicken_biryani | 794             | 450–650       | same + 150g chicken (IFCT breast is fattier than the provisional value)    | same ruling as veg_biryani — keep the two consistent; 100–120g chicken also defensible      |

Structural checks passed: all 41 ingredient refs map to imported ids (`ifct-import.mjs` validates this on every run); `cooking_fat_ml` correctly separated from ingredients (no double-count); roti 25g matches the kitchen calibration's 6″ default; deep-fried items (samosa, vada pav, sev, bhel) correctly carry oil as an ingredient instead of `cooking_fat_ml` (absorbed oil is not katori-distributed oil) — good modelling.

---

## 3. Wiring gap found during verification (not a data question)

**`chaiKcal()` / `coffeeKcal()` are dead code.** `src/engine/kitchen.ts:34,43` are exported and tested, but nothing in the compute path calls them. "1 chai" resolves to `dish_chai` — a fixed ~98 kcal (100ml toned milk + 10g sugar) — and the user's chai calibration (their sugar count, their milk kind, asked in onboarding as part of the moat) is **ignored at compute time**. Two-sugars-full-milk chai (≈82+ kcal by calibration) and no-sugar-black chai (≈5 kcal) both land at 98.

Decide: (a) wire the engine so `ref = dish_chai` computes via `chaiKcal(kitchen)` (recommended — it's why the questions were asked), or (b) drop the chai/coffee calibration questions and keep the fixed dish. (a) is a small engine change; happy to implement on your go.

---

## 4. Engine constants

| constant                                  | value                  | status                                                                                                                                                                                                                          |
| ----------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CUP_ML                                    | 240                    | decide — 240 is the US measuring cup; Indian chai "cup" runs 120–150ml. If 'cup' mostly arrives as a beverage unit, 150 is closer to reality. Recommendation: 150                                                               |
| DEFAULT_MIN_PER_KM (compose.ts)           | 8                      | decide — 8 min/km is a slow jog. For "10 km cycling" it's badly wrong (cycling ≈ 3 min/km). Recommendation: per-exercise min-per-km (walk 12, run 6, cycle 3) or resolve km only for run/walk and mark cycling-by-km unresolved |
| KCAL_PER_STEP_AT_70KG                     | 0.045                  | keep — flagged engineering default, revise on real data (already documented)                                                                                                                                                    |
| MILK for decoction coffee                 | toned assumed          | keep — schema default, documented                                                                                                                                                                                               |
| GLASS_ML 250 / LITRE_ML / TBSP 15 / TSP 5 | —                      | confirmed, standard                                                                                                                                                                                                             |
| OIL_KCAL_PER_ML                           | 9                      | confirmed vs spec arithmetic (ml≈g simplification, documented)                                                                                                                                                                  |
| Surya namaskar rounds                     | qty treated as minutes | decide — users log "12 surya namaskar" (rounds). One round ≈ 45–60s. Recommendation: resolver maps rounds→minutes at 1 round = 1 min (conservative, simple)                                                                     |

---

## 5. What "verified" means after this sheet

- METs: verified against the published Compendium; value changes above await your edition ruling.
- Ingredients: **imported from IFCT 2017 (549 rows, seed generated, lineage per row)** — spot-checked against the book, quality-gated against internal macro consistency.
- Dishes: composition verified structurally + plausibility-checked on **real IFCT values**: 47/50 in band, 3 portion rulings open (§2).
- Constants: two real decisions (cup, km), one wiring fix (chai), rest confirmed.

Once you rule: apply the fixes, rename `*.draft.json` → seed proper, delete the FLAG(nirmal) notes that are resolved, and record the rulings in MASTER.md.

---

## 6. Ref-map choices needing a nod (one-word reversals each)

Where IFCT offers variants, one was picked; where IFCT has no row, a documented supplemental value is used (`scripts/ifct/supplemental.json` carries the lineage note per row):

| ref                                                                      | mapped to                    | note                                                                                      |
| ------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| banana                                                                   | E012 robusta (105)           | most common market banana; montham/poovam/red also exist                                  |
| carrot                                                                   | F002 orange (33)             | red/Delhi gajar is F003 (38)                                                              |
| apple                                                                    | E001 big (62)                |                                                                                           |
| tomato                                                                   | D076 ripe local (20)         | hybrid D075 nearly identical                                                              |
| onion                                                                    | G017 big (48)                |                                                                                           |
| potato                                                                   | F006 brown big (70)          |                                                                                           |
| chicken_meat                                                             | N003 breast skinless (168)   | leg row N001 is corrupt in source; thigh N002 (200) arguably closer to curry-cut — decide |
| chickpea_white                                                           | B002 bengal gram whole (287) | **proxy** — IFCT has no kabuli chana row; nutritionally close                             |
| gram_flour_besan                                                         | B001 bengal gram dal (329)   | **proxy** — besan is milled B001                                                          |
| cucumber                                                                 | D043 elongate (20)           |                                                                                           |
| beans_french                                                             | D050 hybrid (22)             |                                                                                           |
| capsicum                                                                 | D033 green (16)              |                                                                                           |
| cabbage                                                                  | C015 green (22)              |                                                                                           |
| sugar, curd, milk_toned, bread_white, noodles_instant, cream, tea_leaves | SUPP_*                       | not in IFCT; label/derivation values with per-row lineage notes                           |
