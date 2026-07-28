# Launch gate — everything the code cannot do for itself

Status as of 28 Jul 2026. The code half of production readiness is done and green. Nothing on
this page is a coding task: each item needs an account, a signature, a card, a phone, or a
decision only a founder can make. They are ordered so that finishing them top to bottom never
leaves you waiting on something you could have started earlier.

Legend: **[N]** Nirmal · **[NE]** Nehal · **[C]** counsel · **[eng]** engineering, once the
item above it exists.

---

## 0. Before anything touches production

**0.1 [NE] Verify the backups you already have.** `docs/ops-verification.md` is entirely
unchecked, and merging PR #4 auto-applies sixteen new migrations to the live project. Do this first
— the whole page, but the test restore above all. A backup nobody has restored is a hope.

```
# Supabase Dashboard → Database → Backups: note the tier, retention, PITR yes/no
# then restore the latest backup into a scratch project and compare row counts:
select 'entries' t, count(*) from entries
union all select 'weights', count(*) from weights
union all select 'profiles', count(*) from profiles
union all select 'kitchen', count(*) from kitchen;
```

Record the answers in that file. Then §2 of it (pg_cron liveness, reaper `EXECUTE` revoked).

**0.2 [NE] Add the repo secrets the deploy job needs.** Without these, merging to `main` fails
at deploy — or worse, half-deploys.

```
gh secret set SUPABASE_ACCESS_TOKEN   # personal access token, Supabase account settings
gh secret set SUPABASE_PROJECT_REF    # ruynujwntbcgznoiwugl
gh secret set SUPABASE_DB_URL         # SESSION POOLER string — see the warning below
gh secret list
```

Run each without the value on the command line so it never lands in shell history; `gh`
prompts for it.

`SUPABASE_DB_URL` is new: it applies the reference seed (ingredients, dishes, exercises).
Until it exists, production has the tables but no food in them, and every line resolves to
nothing.

> **It must be the session pooler string, not the direct one.** Checked 28 Jul 2026:
> `db.ruynujwntbcgznoiwugl.supabase.co` has **no A record at all** (AAAA only), and GitHub
> runners are IPv4-only — the direct string cannot connect from CI. The pooler host
> `aws-0-ap-south-1.pooler.supabase.com` has A records. The pooler username also differs:
> `postgres.ruynujwntbcgznoiwugl`, not plain `postgres`.
>
> The string carries the database password, so it belongs only in the secret store: never in
> `.env`, never in a commit, never pasted into a chat or an issue. If one ever is, rotate it
> at Project Settings → Database → Reset database password and set the secret again.

**0.3 Dry-run the migrations and the seed.** Half of this is now automated and done:

```
node scripts/db-migration-test.mjs
```

spins a throwaway `supabase/postgres`, applies all 19 migrations and all three seed files in
order, applies the seeds a second time to prove idempotency, and asserts row counts, RLS on
every table, the reaper's revoked EXECUTE, and the validated `entries` constraints. It passes,
and CI runs it on every change under `supabase/`. Its first run caught a syntax error in
generated seed SQL that would have failed the production deploy after the schema had already
changed.

What that does **not** prove is anything about _your_ project: its current schema drift, its
extensions, its data. **[NE]** Still worth one apply against a branch DB before the first
production run:

```
supabase branches create prelaunch-check     # or a scratch project
supabase db push --db-url "<branch url>"
for f in supabase/seed/0*.sql; do psql "<branch url>" -v ON_ERROR_STOP=1 --single-transaction -f "$f"; done
psql "<branch url>" -c "select count(*) from ingredients"   -- expect 549
psql "<branch url>" -c "select count(*) from dishes"        -- expect 50
psql "<branch url>" -c "select count(*) from dish_ingredients" -- expect 141
psql "<branch url>" -c "select count(*) from exercises"     -- expect 20
```

**0.4 [eng, after 0.1–0.3] Merge PR #4.** Only then. The merge is what triggers the deploy.

---

## 1. The schedule-deciding one

**1.1 [N] The dish table: 50 of 400–600.** Everything else on this page is a day's work or a
signature. This is weeks, it is yours by MASTER's own rule, and resolver accuracy,
`unresolved_rate`, and day-7 retention are all capped by it. At 50 dishes a Vadodara user hits
`unresolved` in their first few lines.

The machinery is built and waiting: [`dish-table-workflow.md`](dish-table-workflow.md) has the
shape of a dish, the raw-vs-served rule, and the batch loop. Structural mistakes fail before
review; your time goes to the numbers and the bands.

**1.2 [N] Correct the resolver eval set.** `test/eval/hinglish-500.jsonl` is model-drafted, so
the Phase-2 gate number is not valid until you have been through it — `test/eval/README.md`
lists the ~10 labelling conventions awaiting your ruling. Do this **with** the dish table:
they are coupled by dish ids, and correcting them separately means doing the join twice.

---

## 2. Make the resolver real

**2.1 [N/C] Name the model provider and sign processor terms.** The hard gate: spec/08 needs
zero retention, no training on our data, and the provider named in the privacy notice.
Anthropic Haiku is implemented as the candidate; the swap is one file
(`supabase/functions/resolver-classify/providers.ts`). See `founder-rulings.md` A1.

**2.2 [NE, after 2.1] Key in, eval run.**

```
# .env  (git-ignored)
RESOLVER_PROVIDER_API_KEY=...

RESOLVER_EVAL=1 npx vitest run test/resolver-eval.test.ts
# gate: >=90% intent accuracy, unresolved_rate < 5%, zero confident-wrong-ref
```

The gate number only counts against the corrected eval set (1.2).

**2.3 [eng] Deploy the edge functions and their secrets.** All four are authored; none have
ever run.

```
supabase functions deploy resolver-classify
supabase functions deploy delete-account
supabase functions deploy revenuecat-webhook
supabase functions deploy entitlement-refresh

supabase secrets set RESOLVER_PROVIDER_API_KEY=... \
                     REVENUECAT_WEBHOOK_SECRET=... \
                     REVENUECAT_SECRET_API_KEY=...
supabase secrets list
```

The CD job does the deploys on merge to `main`; the secrets are still manual.

**2.4 [NE] Run the RLS cross-user gate against the deployed schema.** It has never run in CI
because it needs a live project.

```
RLS_TEST=1 npx vitest run test/rls-cross-user.test.ts
```

---

## 3. Money

**3.1 [NE] RevenueCat.** Create products `slate_monthly_199` and `slate_yearly_1499` (7-day
trial on yearly only), the entitlement, and the iOS app. Then:

- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` into `.env` and EAS secrets;
- webhook URL → the deployed `revenuecat-webhook`, with the shared secret from 2.3;
- App Store Connect: the same two products, priced ₹199 / ₹1,499, with review screenshots.

**3.2 [N] Apple Developer org verified.** D-U-N-S was pending at Week 0. Everything in §4
blocks on this.

---

## 4. A build that exists

**4.1 [eng, after 3.2]**

```
eas init                      # writes extra.eas.projectId into app.json
eas build --profile preview --platform ios
```

**4.2 [NE] Fill the submit block.** `eas.json` still holds `REPLACE_WITH_*` for `appleId`,
`ascAppId`, `appleTeamId`.

**4.3 [N] TestFlight, then the device half.** Nothing in this repo has ever run on an iPhone.
The list is in the punch list: xxLarge Dynamic Type, VoiceOver by ear, reduced motion,
airplane mode across every flow, scanner camera, purchase and restore, export share sheet,
delete flow, notification permissions.

---

## 5. Legal, and the things that are only legal

**5.1 [C] Privacy policy review and publish.** `docs/privacy-policy-draft.md` has two
placeholders that cannot be filled without 2.1: the model provider's name, and the DPDP
§11/§12/§13 citations against the notified Rules. App Review checks the link; DPDP requires it
to be reachable.

**5.2 [N] Name the grievance officer**, publish the contact, and register the domain and
support mailbox — `slate.app` and `support@slate.app` are placeholders in the code today
(`founder-rulings.md` A2).

**5.3 [N/NE] Breach playbook owners.** `docs/breach-playbook.md` needs a named decision-owner
and deputy. 72 hours is not enough time to decide who decides.

**5.4 [C] At-rest encryption ruling.** SQLite and AsyncStorage are unencrypted on device.
iOS Data Protection covers a locked device; app-level SQLCipher raises the DPDP §8 bar. Carried
since Phase 5.

---

## 6. Able to see what happens

**6.1 [NE] PostHog.** Key into `.env`, and wire the two `TODO(C1)` capture sites in
`src/lib/report.ts`. PR #2 is an unmerged draft. `docs/analytics-handoff.md` has the
constraints — self-host `ap-south-1`, no autocapture, `raw_text` impossible by construction.

**6.2 [NE] Sentry.** Same two TODOs. Without it the app ships blind: no crash telemetry, no
abuse signal, no resolver cost signal.

**6.3 [eng, after 6.1] The week-8 dashboard.** `unresolved_rate` and resolver p95. Without it
the only question that matters after TestFlight — did anyone log on day 7 — is unanswerable.

---

## 7. Words

**7.1 [N] App Store listing.** `docs/app-store-listing.md` needs final wording. Say in it that
refunds go through Apple — it is the sharpest differentiator in a category whose review pages
are wall-to-wall refund disputes.

**7.2 [N] Rule the open flags.** `docs/founder-rulings.md`: two gate launch (A1, A2), eight are
product calls, five are numbers to bless. None of the eight block a TestFlight build, but they
should be settled before the listing is final.

---

## Not blocking, tracked

- `npm audit`: the dev tree carries `brace-expansion` GHSA-mh99-v99m-4gvg through eslint's
  minimatch@3. Unfixable — no patched 1.x or 2.x exists and 5.x is not CJS-callable. The
  blocking gate audits the production tree only; the full audit prints every run. Re-check on
  the next eslint major.
- `uuid <11.1.1` moderate via `xcode` → `@expo/config-plugins`: build-time, never shipped.
  Fix is a breaking `expo-splash-screen` bump; defer to a coordinated Expo SDK upgrade. Do not
  run `npm audit fix --force`.
- Migration deploy safety: `supabase db push` on merge auto-applies with no tested rollback.
  The CI harness (0.3) now proves the SQL is correct and idempotent before it runs; a rollback
  path for a migration that is _valid but wrong_ is still missing, which is what the backup in
  0.1 is for.
- Seed filenames still say `.draft` — deliberate, until the eval set is corrected (1.2).
