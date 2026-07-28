# Phase 7 — Production harden: punch list (the honest gate)

Status: **code gate green locally and now on CI too, PR open, launch gate NOT met.** Phase 7
closes the code half of production readiness. It does not close launch. Everything that turns
this code into a shippable product is listed under "Blocked" below, and the first item there
is the one that decides the schedule.

Branch: `phase-7-production-harden`, 32 commits ahead of `main`, fast-forwards cleanly.
PR: [#4](https://github.com/nirmalamin24bak/slate/pull/4).

Gate re-run 2026-07-28 (the branch had sat idle since 13 Jul):

- `tsc --noEmit` clean
- `eslint .` clean
- `vitest run --coverage` — **518 passed / 2 skipped**, every per-glob threshold holds
  (statements 98.01%, branches 89.36%, functions 98.50%, lines 99%)
- `npm audit --omit=dev --audit-level=high` — 0 high in the tree that ships

**Correction to the first version of this page:** it claimed the code gate was green while
PR #4's `check` job was in fact red, and had been since the job was added. `deno check` could
not resolve `npm:@anthropic-ai/sdk` — the repo root's package.json put Deno into node_modules
resolution, where a server-only SDK the Expo app never installs cannot be found. Fixed in
`d83deba` with `supabase/functions/deno.json` (`nodeModulesDir: "none"`, which is also the
truthful production setting) and an explicit `--config` in CI. Verified locally with deno
2.5.4 before pushing. The lesson: a local gate run is not the gate.

The 2 skipped are the opt-in integration gates, by design: `test/resolver-eval.test.ts`
(needs `RESOLVER_EVAL=1` and a model key) and the RLS cross-user gate (needs `RLS_TEST=1`
and applied migrations). Both are blockers in their own right — see below.

The two hair's-breadth thresholds are fixed, not watched (`e93e3f7`): the down-sync merges'
sparse-payload fallbacks and `fetchOffProduct` are now tested, taking `src/db` branches from
75.19% to 81.40% and `barcode.ts` to 100% on all four metrics. Floors raised under the real
numbers (`src/db` 95/80/95/98, barcode 100). `src/journal` branches at 79.11% against a 78%
floor is now the thinnest margin left.

---

## Delivered this phase (with how)

**Crash safety and observability**

- Root error boundary at the app shell, and a central report sink (`src/lib/report.ts`) that
  every silent failure path now routes through instead of swallowing. Env access
  centralized so no module reads `process.env` directly (`c6fc821`, `d8da446`).
- Journal day writes are transaction-wrapped, and rows found stuck in `resolving` after a
  crash are recovered on next open rather than sitting dead in the UI (`2e66844`).
- Loading and error states across the screens; journal line list virtualized and hot-path
  children memoized (`0953bc0`, `a5e09d1`).

**Sync (spec/04)**

- Bidirectional user-data sync with an atomic push and guarded conflict resolution
  (`7eeb6bf`).
- Down-sync is now incremental — a per-table watermark instead of a full table pull
  (`e82e544`).
- Re-entrancy guard so two syncs cannot interleave, plus a user-visible "not backed up"
  signal rather than failing quietly (`c79ec9b`).
- Client clock skew clamped server-side on the sync-upsert RPCs, so a wrong device clock
  cannot reorder or resurrect rows (`ebbee48`).

**Entitlements (spec/07)**

- Plus is server-authoritative via the RevenueCat webhook; the client cannot grant itself
  entitlement (`b17325d`).
- Webhook writes go through an atomic RPC with replay and out-of-order guards (`fd598e0`).
- Per-user cooldown on entitlement-refresh (`26d62d9`).
- The paywall sells only features that exist today; stub nav paths are hidden (`cb5a142`).

**Security and DB**

- `delete-account` hardened, deletion audit trail added, resolver context tokens pinned
  (`b0dead3`).
- `entries` check constraints added, then `VALIDATE`d as a separate migration so the lock is
  brief (`2b7a3fe`, `be98daa`).
- Resolution cache: injection defense, closed to client reads, confidence `NOT NULL`.
- Resolver rate-limit reaper, with `EXECUTE` revoked from `anon` and `authenticated`
  (`044ca44`) — verify this landed in prod, see `docs/ops-verification.md`.
- Resolver kill switch consumed by the client, bounded retry, budget accounting
  (`7745b7b`, `7704257`).
- Body and weight numeric fields clamped at the input boundary (`f88fd9f`).

**Nutrition data (spec/06)**

- IFCT 2017 imported: **549 ingredient rows** (542 IFCT + 7 supplemental), lineage per
  value, through a committed and reproducible pipeline under `scripts/ifct/`. License
  verified clean (npm artifact is MIT; the repo's later AGPL relicense never reached npm).
  The import gate flags 5 genuine source errors on every run so a future dish ref never
  lands on one (`a5b20f0`).
- Exercise METs retabled to the 2024 Adult Compendium, all 20 entries, citations fixed
  (`dd40ae6`). Gym MET set conservatively to 4.0 to guard the exercise-as-allowance loop.
- Chai calibration wired into `compose.ts` — `dish_chai` computes from the kitchen answers
  (black no-sugar ≈5 kcal, two-sugars-full-milk ≈90) instead of a fixed recipe.
  `CUP_ML` 240→150 for an Indian beverage cup. km→minutes now per-mode so "10 km cycling"
  no longer credits jog-pace burn (`2dd1b21`).
- Dish portion and chicken-cut rulings applied — `chicken_meat` is thigh (IFCT_N002), the
  curry and biryani cut (`4ec8bc7`). 47/50 dishes land dead-centre of the plausibility
  bands; the 3 outliers are within the ±20% target and explained in
  `docs/nutrition-verification.md`.
- Kaggle "Indian Food Nutrition" vendored as a **directional cross-check only** — nothing
  from it enters the seed, because its serving basis is undocumented and inconsistent
  (`9ae4f96`).

**Release plumbing**

- `eas.json`, CD pipeline, edge-function CI, `docs/app-store-compliance.md`, feature flags
  (`3206519`).

---

## Owed to the real-device half (Nirmal)

Nothing in this repo has ever run on an iPhone. The Node suite cannot exercise iOS render,
native props, or any native module. Carried and still open from Phases 3 through 7:

- xxLarge Dynamic Type walkthrough — journal, stats, settings, onboarding. No number wraps
  or ellipsizes.
- VoiceOver pass by ear: journal line as one utterance, drawer, sheets, calendar cells,
  retry button, scanner.
- Reduced motion flipped on: shimmer static, number settle instant.
- Airplane-mode re-pass across every flow (spec/10 wk8). The automated journal test exists;
  onboarding, scanner, and export still need the device.
- Scanner camera. Purchase and restore. Export share sheet. Delete flow. Notification
  permissions.

## Blocked — the launch gate

These are ordered by what actually decides the schedule.

1. **The dish table is at 50 of 400–600.** `spec/10` §Weeks 3–6 and `MASTER.md` both say
   Nirmal owns it and it is not delegable to a model. Resolver accuracy,
   `unresolved_rate`, and day-7 retention are all capped by this number. At 50 dishes a real
   user in Vadodara hits `unresolved` inside their first few lines. This is the schedule.
   The machinery around it is now built — see [`dish-table-workflow.md`](dish-table-workflow.md):
   a dish enters only with a declared kcal band, checked through the real engine, and every
   structural failure (bad ref, duplicate alias, double-listed ingredient, undecided serving
   weight) fails before review. Review time goes to the numbers.
2. **Reference data now has a deploy path — built 28 Jul 2026, one secret and one dry run
   short of done.** The gap: `supabase db push` applies migrations only, a seed file never
   reaches a remote project, and there was no dish or exercise seed SQL at all — production
   would have come up with empty `ingredients`, `dishes` and `exercises`, and every food line
   would have failed regardless of the resolver. Now: `scripts/seed-reference.mjs` generates
   `02_dishes.sql` and `03_exercises.sql` from the reviewed json, CI fails if the committed SQL
   drifts from it, and the deploy job applies all three files in order (`psql
--single-transaction -v ON_ERROR_STOP=1`). **Still needed from you:** the `SUPABASE_DB_URL`
   repo secret, and one apply against a branch DB — nobody has run 02/03 against a live
   Postgres.
3. **The resolver has never run live.** `RESOLVER_PROVIDER_API_KEY` is empty,
   `resolver-classify` is not deployed, and the Phase-2 gate (≥90% intent accuracy,
   `unresolved_rate` < 5%, zero confident-wrong-ref) has never been measured. Separately,
   the 500-line gold set is model-drafted — `test/eval/README.md` states the gate number is
   not valid until Nirmal has corrected every label, and lists ~10 labelling conventions
   awaiting his ruling. Correct the eval set and the dish table together; they are coupled
   by dish ids.
4. **No build exists.** `app.json` has no `extra.eas.projectId` (`eas init` never run) and
   `eas.json`'s submit block still holds `REPLACE_WITH_*` for the Apple ID, App Store
   Connect app id, and team id. Confirm the Apple Developer org is verified first — it was
   D-U-N-S pending at Week 0.
5. **RevenueCat key empty.** Products `slate_monthly_199` / `slate_yearly_1499`, the
   webhook, and `Purchases.logIn(supabaseUserId)` are all coded, but no purchase has ever
   been made.
6. **PostHog key empty**, and `src/lib/report.ts` still carries the two `TODO(C1)` capture
   sites. PR #2 is an unmerged draft. Consequence: the week-8 `unresolved_rate` and
   resolver-p95 dashboard does not exist, so the only question that matters after TestFlight
   — did anyone log on day 7 — is currently unanswerable.
7. **Privacy policy unpublished** (`docs/privacy-policy-draft.md`): counsel review, plus two
   open placeholders — the resolver model-provider name, and the DPDP §11/§12/§13 citations
   against the notified Rules. Grievance officer not yet named.
8. **`docs/ops-verification.md` is entirely unchecked** — daily backups, PITR decision, one
   test restore, `pg_cron` present, reap job active, reaper `EXECUTE` revoked. The test
   restore is the highest-value item on that page. A backup never restored is a hope.
9. **Breach playbook** (`docs/breach-playbook.md`) needs the named decision-owner and
   deputy. **App Store listing** (`docs/app-store-listing.md`) needs final wording.
10. **SQLite / AsyncStorage at-rest encryption decision**, carried from Phase 5, DPDP.
    Decide with counsel.
11. **Edge Function deploys**: `resolver-classify`, `delete-account`, `revenuecat-webhook`,
    `entitlement-refresh`. All authored, none deployed.

## Tracked, not blocking

- **`npm audit`**: 0 high, 0 critical, 12 moderate — all one transitive root, `uuid <11.1.1`
  (GHSA-w5hq-g745-h8pq) reached through the Expo build toolchain. Build-time only, not
  shipped runtime. Fix is a breaking `expo-splash-screen` bump; defer to a coordinated Expo
  SDK upgrade. Do not `npm audit fix --force`.
- **Migration deploy safety**: `supabase db push` on merge to `main` auto-applies to prod
  with no dry-run gate and no tested rollback. Before a risky migration, apply to a branch
  DB first. A migration-test harness in CI is the follow-up (noted in
  `docs/ops-verification.md` §3).
- **Every open `FLAG(nirmal)` is now collected in [`founder-rulings.md`](founder-rulings.md)**
  with the value the code carries today, the argument, and the exact edit that applies a
  ruling — grouped into the two that gate launch (resolver provider's DPDP terms, the
  placeholder URLs), eight product rulings, five rate/budget numbers to bless, and four stubs
  that need a spec rather than a ruling. Reply with an item number to close one.
- **Seed filenames still say `.draft`**. Deliberate: the resolver eval case set is still
  uncorrected, so renaming the seeds would churn the eval harness mid-flight. Rename once
  the eval set is corrected.
- `app/chat.tsx` is a deliberate "coming soon" stub, hidden from nav. It is the only such
  screen.
