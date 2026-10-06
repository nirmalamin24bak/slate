# HANDOVER — Slate, 6 Oct 2026

For whoever picks this repo up next, human or agent. Read `CLAUDE.md` and `MASTER.md` first.
This file covers only where things stand and what is left. The ordered launch checklist is
[`docs/launch-gate.md`](docs/launch-gate.md); this file records what has changed since it was
written on 28–29 Jul.

---

## Where the code stands

The code half of production readiness is done. Nothing has run on a phone yet.

Gates, run 6 Oct 2026 on Node 24.14 against this branch:

| Gate                                                | Result                                                |
| --------------------------------------------------- | ----------------------------------------------------- |
| `npm ci`                                            | ok                                                    |
| `npx tsc --noEmit`                                  | clean                                                 |
| `npx eslint .`                                      | clean                                                 |
| `npx vitest run --coverage`                         | 635 passed, 2 skipped, coverage thresholds hold       |
| `node scripts/db-migration-test.mjs` (needs Docker) | 25 migrations, 3 seed files, 66 checks, green         |
| `npm audit --omit=dev --audit-level=high`           | **fails**: 1 critical, 29 high (see the next section) |

- Stack: Expo SDK 57, React Native 0.86, React 19.2, Expo Router, TypeScript strict. Supabase:
  Postgres with RLS, anonymous auth, four Edge Functions. `expo-sqlite` on the device,
  RevenueCat for purchases. iOS only.
- The four Edge Functions (`resolver-classify`, `delete-account`, `revenuecat-webhook`,
  `entitlement-refresh`) are written and tested but have never been deployed.
- The resolver has never run against a real model. There is no provider key and no signed
  processor terms yet (`docs/founder-rulings.md` A1).
- `eas init` has never run. So there is no EAS project, no build and no OTA updates, and
  `eas.json` still carries `REPLACE_WITH_*` values.
- The dish table holds 55 dishes of the 400–600 planned. 61 IFCT ingredient refs are mapped,
  which is enough for batch 1 of `docs/dish-backlog.md`. No batch-1 dish is written yet.
- `test/eval/hinglish-500.jsonl` is model-drafted. Nirmal must correct it before its gate
  number means anything.

### The red audit gate

Advisories published after 29 Jul flag 1 critical and 29 high packages in the production
dependency tree. CI's `check` job runs this audit as a blocking step, so **every PR is red until
it is resolved**. The flagged code is mostly the bundler, dev-server and CLI chain: metro,
@expo/cli, braces/micromatch, node-forge, @xmldom/xmldom (via plist), shell-quote, compression,
image-size, js-yaml, source-map-js, browserslist and nanoid. It is pulled in through `expo`,
`react-native`, `react-native-purchases` and their dependencies.

`braces` and `node-forge` have no patched release inside the SDK 57 tree. npm's suggested "fix"
is a downgrade to expo 44 and react-native 0.72. Don't take it, and don't run
`npm audit fix --force`. The ways out are an Expo SDK patch or upgrade, or targeted `overrides`
for the packages that do have patches. Whether to relax the gate in the meantime is Nirmal's
call.

---

## Supabase: the project is `rhnukmnazznlgvvcjibv`, in Mumbai

- The project is `rhnukmnazznlgvvcjibv` (`https://rhnukmnazznlgvvcjibv.supabase.co`), created
  6 Oct 2026. It was verified in **ap-south-1** that day in two independent ways:
  - its database host resolves to an address that AWS's published ranges place in ap-south-1;
  - the Mumbai session pooler `aws-0-ap-south-1.pooler.supabase.com` recognises the project and
    asks for a password, while `aws-1-ap-south-1` and the Tokyo pooler answer "tenant not found".
- `node scripts/check-region.mjs` now gives a real answer: exit 0 in ap-south-1, 1 anywhere
  else, 2 when it cannot tell. It places `db.<ref>.supabase.co` in AWS's published ranges. The
  old version read a response header that Supabase stopped sending, so it returned
  "Indeterminate" with exit 0 for every project, the Tokyo one included.
- The project is empty. No migration, seed or function has been applied to it.
- Two earlier projects are gone:
  - `ruynujwntbcgznoiwugl`, the original (ap-south-1), no longer resolves. The app never
    shipped, so no user data was on it.
  - `innlmtllaxpelfcyhriq` was created on 6 Oct in ap-northeast-1 (Tokyo), rejected under
    MASTER.md's DPDP residency rule, and deleted the same day.
- The GitHub repo secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `SUPABASE_DB_URL`
  were set on 28 Jul and still target the original project. Replace all three together. A
  deploy with the new ref but the old database URL would change the new schema and then fail
  at the seed.

### Already done in the repo (6 Oct 2026)

These now name `rhnukmnazznlgvvcjibv`:

- `supabase/config.toml`;
- `.env.example`;
- the fallback in `scripts/check-region.mjs`;
- the example string in `scripts/psql.ps1`;
- `docs/launch-gate.md` §0;
- the test fixtures.

The old ref in the fixtures was only text: supabase-js derives the `sb-<ref>-auth-token`
storage key itself, and nothing in `src/` hardcodes a ref.

### Still to do, in order

1. **Dashboard (owner).**
   - Allow anonymous sign-ins. The app has no login screen and signs every install in
     anonymously.
   - After the first deploy, confirm `pg_cron` per `docs/ops-verification.md` §2.
2. **GitHub (owner).**
   - Replace the three secrets together. `SUPABASE_PROJECT_REF` is `rhnukmnazznlgvvcjibv`.
   - `SUPABASE_DB_URL` is the **session pooler** string on port 5432. It uses `aws-0`, not the
     `aws-1` the original project used:
     `postgresql://postgres.rhnukmnazznlgvvcjibv:<PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`.
     GitHub runners are IPv4-only and the direct database host is IPv6-only, so the direct
     string cannot work. Test the string with `scripts/psql.ps1` before saving it
     (`docs/launch-gate.md` §0.2).
   - Add required reviewers to the `production` environment.
3. **Local `.env` (owner, git-ignored).** Set the new `EXPO_PUBLIC_SUPABASE_URL` and the project's
   publishable (anon) key.
4. **First deploy.**
   - Open a PR from `rork` to `main`, get CI green, and merge.
   - Set the Edge Function secrets (`docs/launch-gate.md` §2.3).
   - Run `RLS_TEST=1 npx vitest run test/rls-cross-user.test.ts` against the live project.

### Unverified: check these on the first deploy

The repo was written against a project created in July 2026 and has never been deployed. A
project created in October may differ. None of the following has been checked against current
Supabase docs:

- **Postgres version.** The migration harness tests on Postgres 15
  (`supabase/postgres:15.8.1.060`). If the new project runs 17, run
  `node scripts/db-migration-test.mjs --image <a 17.x supabase/postgres tag>` first.
- **API keys.** The client reads `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and the Edge Functions read
  `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. New projects lead with publishable and
  secret keys. Confirm that the legacy keys exist and are injected into functions, or adapt.
- **JWT verification.** `supabase/config.toml` sets `verify_jwt` per function. Confirm the
  gateway accepts the project's user tokens if it uses asymmetric signing keys.
- **Data API grants.** The migrations rely on Supabase's default privileges for `anon` and
  `authenticated`. If the project does not auto-expose new tables and functions, the app's
  reads, writes and RPCs fail with permission errors.
- **CI database access.** Check that `supabase db push` in the deploy job reaches the database
  from an IPv4-only GitHub runner. The direct host is IPv6-only.

---

## Branches, and what a push to `main` does

| Ref                              | What it is                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `main`                           | Phase 6 (PR #3, merged 11 Jul). **A push here deploys to production.**                                                    |
| `phase-7-production-harden`      | PR #4, open. Fully contained in `rork`.                                                                                   |
| `phase-8-audit-fixes`            | The audit fixes. Identical to `rork` minus this handover commit.                                                          |
| `rork`                           | Phases 7 and 8, plus this file. Work here.                                                                                |
| `posthog/instrumentation-0dc2fc` | PR #2, a draft from 10 Jul. It predates `docs/analytics-handoff.md`, so check it against that doc before using any of it. |
| tag `handover-2026-10-06`        | The exact state handed over. Diff against it, or roll back to it.                                                         |

On every push to `main`, `.github/workflows/ci.yml` runs `check` and `db`, then `deploy`:

- `supabase db push` against the live project;
- the reference seed, applied over `psql`;
- the four Edge Functions;
- a smoke test of the functions.

No required reviewer is configured, because the `production` environment has not been created
in the repo settings. So a merge deploys immediately.

Pushes to `rork` trigger nothing. A PR from `rork` to `main` runs `check` and `db` without
deploying. **Work on `rork`. When a change is ready, open a PR to `main` and get CI green. Merge
only when you mean to deploy**, and not before the secrets point at the Mumbai project.

Commits made outside a local clone (Rork, the GitHub web editor) skip the husky pre-commit hook,
which runs typecheck and the full suite. CI on a PR is then the only gate, and today the audit
gate makes it red. Run the gates in the first table before asking for a merge.

---

## Rules that bind whoever works here

Each of these is in `CLAUDE.md` or `MASTER.md`, with its reason. These are the ones an AI
builder is most likely to break.

1. **A model never generates the dish table.** Every number traces to an IFCT 2017 row through a
   recipe, and Nirmal writes or reviews the numbers and the bands
   (`docs/dish-table-workflow.md`). Do not add or change entries from model output in any of
   these:
   - `supabase/seed/dishes.draft.json`
   - `supabase/seed/dish-bands.json`
   - `supabase/seed/exercises.draft.json`
   - `scripts/ifct/`
   - `test/eval/`
2. **The resolver never emits calories.** The model maps a line to `{intent, ref, qty, unit}`,
   and nutrition comes from the tables.
3. **No login screen, no goal recommendation, no ads, no coaches, no meal plans, no outcome
   streaks.** Sign-in is an offer in Settings, never a gate.
4. **Displayed net calories never go below 1,200, and the goal field rejects anything lower.**
   Steps count only above 3,000, and never add to an ambulatory exercise on the same day.
5. **`test/guardrails/` fails the build if a floor, banned copy or a placeholder URL regresses.**
   Fix the code; never loosen the test.
6. **Every table gets RLS in the migration that creates it.** Add new migrations and never edit
   one that has been applied. Any change under `supabase/` needs
   `node scripts/db-migration-test.mjs`.
7. **`raw_text` never reaches analytics, logs or crash reports.** The boundaries in
   `src/lib/analytics.ts`, `src/lib/report.ts` and the Edge Functions' `LogFields` are closed by
   construction. Keep them closed.
8. **Secrets stay out of the repo and out of the client.** Their names are in `.env.example`.
   The service-role key, the resolver API key and the RevenueCat secrets are Edge Function
   secrets, never `EXPO_PUBLIC_` variables.
9. **Supabase lives in ap-south-1, and v1 is iOS only.** `node scripts/check-region.mjs <url>`
   must exit 0 before any project is wired in. Canonical units are cm, kg, ml and g. TypeScript
   is strict, with no `any`, and every number uses tabular figures.
10. **If a decision is not in `MASTER.md`, it was not made.** Ask Nirmal rather than inventing a
    default and shipping it.

---

## What's left

The ordered list is `docs/launch-gate.md`. In short:

**Needs the owners (accounts, money, signatures, judgement):**

- Set up the Mumbai project: the dashboard options, the three GitHub secrets, and required
  reviewers on the `production` environment (see "Still to do", above).
- Run the backup restore drill on the new project before launch (`docs/ops-verification.md`).
- Grow the dish table to about 270 (batches 1–4 of `docs/dish-backlog.md`), correcting the eval
  set alongside it. This decides the schedule.
- Name the resolver provider and sign zero-retention processor terms (A1), then add the API key.
- Get the Apple Developer org verified (D-U-N-S), and set up the App Store Connect products and
  the RevenueCat products and webhook.
- Register the domain and support mailbox, and name the grievance officer (A2; `slate.app` is a
  placeholder). Also:
  - counsel's review of `docs/privacy-policy-draft.md`;
  - owners for the breach playbook;
  - the at-rest encryption ruling.
- Settle the open rulings in `docs/founder-rulings.md` (B1–B8 and the C numbers), and the 90-day
  retention line for abandoned anonymous accounts.
- Write the App Store listing copy, and do a TestFlight pass on a real iPhone.

**Engineering, once whatever it depends on exists:**

- Do the first deploy to the Mumbai project, once its secrets are in (see "Still to do", above).
- Clear the audit gate.
- Run `eas init`, make a preview build, add `expo-updates` for OTA, and fill in the `eas.json`
  submit block.
- Run the resolver eval: `RESOLVER_EVAL=1 npx vitest run test/resolver-eval.test.ts`. The gate is
  at least 90% intent accuracy, an unresolved rate under 5%, and zero confidently wrong refs.
- Turn on PostHog and Sentry, one install and one env var each; the boundaries are written and
  inert. Then add alerting on the four signals in `docs/phase-8-audit-fixes.md`, and build the
  week-8 dashboard.
- Later: candidate filtering in the resolver once the dish table passes about 400. The hidden
  stubs (chat, widget, Apple Health, label scanner) each need a spec first.

---

## Not in the repo

`docs/DGI_2024.pdf` (24 MB) is untracked and exists only on the owner's machine.
