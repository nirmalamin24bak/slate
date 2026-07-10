# 10 — Build Plan

Eight weeks to TestFlight. Ordered by dependency, not by excitement.

The dish table is the long pole. It starts week 1 and runs in parallel with everything.

---

## Week 0 — Before code

- [ ] Supabase project, region **`ap-south-1`**. This cannot be changed later.
- [ ] Expo app, TypeScript strict, EAS configured
- [ ] Inter Tight loaded, tabular figures verified on a device
- [ ] Apple Developer org account (D-U-N-S pending), Basanth as App Manager
- [ ] RevenueCat project, products `slate_monthly_199` / `slate_yearly_1499`
- [ ] **Build the 500-line Hinglish test set.** Nirmal, Nehal, ten friends. Hand-labelled. Everything downstream is measured against this.

---

## Weeks 1–2 — The engine

Nothing visible. Do not skip ahead.

- [ ] Import IFCT 2017 → `ingredients`
- [ ] Schema + RLS in the first migration. Every table, no exceptions.
- [ ] `dish_ingredients` recipe format, and the first 50 dishes
- [ ] `toGrams()` — unit conversion, kitchen-aware, pure
- [ ] `computeEntry()` — pure, deterministic, unit-tested
- [ ] BMR (Mifflin-St Jeor × 0.90), baseline (× 1.2, no activity multiplier)
- [ ] MET table from the Compendium, with `is_ambulatory` flags
- [ ] Steps burn: `max(0, steps − 3000) × 0.045 × (kg/70)`
- [ ] Double-count resolution: `max(steps_burn, ambulatory_burn)`, loser marked `included`
- [ ] Water (250ml/glass, sums) and sleep (no math) pass-throughs
- [ ] Personalization clamp (±20% total, ±30% fat)

**Exit criterion:** given a resolution and a kitchen, nutrition is computed identically on every run. 100% test coverage on this module. It never changes after this. **Includes a test proving `9000 steps` + `45 min walk` on one day yields one burn, not two.**

---

## Weeks 2–4 — The resolver

- [ ] `normalize()` — Hinglish transliteration, whitespace, punctuation
- [ ] `resolution_cache` table + Edge Function writer (service role)
- [ ] LLM classify → strict JSON parse → validate against catalogue
- [ ] Six intents: food / exercise / weight / water / steps / sleep, plus unresolved
- [ ] Weight disambiguation, including conversational phrasing ("I'm at 72 kg")
- [ ] Steps parsing (`8k` → 8000) and the ambulatory-collision flag
- [ ] `context` detection (outside / home)
- [ ] Multi-entry line splitting (`2 roti aur ek katori dal`)
- [ ] Retry queue + exponential backoff

**Exit criterion:** ≥ 90% intent accuracy on the 500-line test set. `unresolved_rate` < 5%. Never a wrong `ref` with confidence > 0.6.

Ship `resolve(text): Promise<Resolution[]>` behind one interface. The model must be swappable in one file.

---

## Weeks 3–6 — The dish table *(runs in parallel)*

400–600 dishes, composed from IFCT, with lineage. This is the moat and it is manual.

Priority order:
1. **Breads & staples** — roti, phulka, paratha, naan, rice, khichdi, dosa, idli
2. **Dals & legumes** — every regional variant that matters
3. **Sabzis** — the twenty most-cooked
4. **Beverages** — chai, coffee, lassi, nimbu pani. Do these early; they're high-frequency and currently the most wrong.
5. **Restaurant & street** — biryani, vada pav, pav bhaji, chole bhature, momos
6. **Regional** — Gujarati, South Indian, Bengali variants

Nirmal owns this. Nehal reviews. It is not delegable to a model.

---

## Week 5 — The journal

The core loop. Build it last among the UI, because it depends on everything above.

- [ ] Multiline text editor, line = entry
- [ ] Line state machine (draft → resolving → resolved | unresolved)
- [ ] Resolve shimmer, number settle
- [ ] Header total + summary card, live recompute
- [ ] SQLite write-through, offline queue
- [ ] Suggestion strip (recents + saved)
- [ ] Tap-to-detail sheet
- [ ] Nickname → saved food
- [ ] Pull-down day scrubber

**Exit criterion:** five lines typed in airplane mode, force-quit, reopen, restore network — all five resolve in order with correct totals.

---

## Week 6 — Onboarding & setup

- [ ] O0 privacy notice
- [ ] O1–O5 teaching screens
- [ ] O6 body / BMR (skippable, no fabricated number on skip)
- [ ] O7 **Your kitchen** — the four questions
- [ ] O8 goal (empty field, no suggestion)
- [ ] O9 notifications
- [ ] O10 Start → journal, no auth
- [ ] Anonymous Supabase session at install; flush onboarding state on session

---

## Week 7 — Everything else

- [ ] Drawer, Settings, Customize display, Personalization
- [ ] **"What you can write" hub** + six teach sheets; tapping an example inserts it into the journal
- [ ] Hide calorie counts (free)
- [ ] Stats — week / month / year / range
- [ ] Barcode + label scanner
- [ ] Paywall, RevenueCat, `Purchases.logIn(supabaseUserId)`
- [ ] Export your data (JSON + CSV)
- [ ] Delete my data (hard delete, cascade)
- [ ] Dark mode
- [ ] Widgets (lock screen, home screen) — Expo config plugin; **budget two extra days**, this is the flakiest part of the stack

---

## Week 8 — Harden

- [ ] Airplane-mode pass across every flow
- [ ] Dynamic Type to `xxLarge`
- [ ] VoiceOver on the journal line
- [ ] Reduced motion
- [ ] Safety guardrails verified: net floor, goal floor, no celebration copy
- [ ] `unresolved_rate` and resolver p95 on the dashboard
- [ ] Privacy policy live; grievance officer named
- [ ] Breach playbook written
- [ ] App Store listing — lead with *No login. No coaches. No sales calls.*
- [ ] TestFlight to 30 people who eat Indian food daily

---

## After TestFlight, before launch

The only question that matters: **did anyone log on day 7?**

Not installs. Not paywall views. Day 7 retention on a food journal is the whole business. If it's below 15%, the resolver is wrong or the dish table has a hole, and no amount of design fixes either.

Check `unresolved_rate` by user before you check anything else.

---

## Explicitly not in these eight weeks

Photo logging · Chat · Apple Health · Custom dishes · Android

They're Plus features and platform bets. Ship the free tier first, learn whether the loop holds, then build what people are paying for.
