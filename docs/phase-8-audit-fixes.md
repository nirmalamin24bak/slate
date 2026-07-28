# Phase 8 — Audit fixes: punch list

Status: **the whole 30-day remediation plan is landed; the launch gate in
[`phase-7-punch-list.md`](phase-7-punch-list.md) is unchanged.** This phase closes findings from a
production-readiness audit run on 29 Jul 2026 against the whole tree — 20 migrations, 4 Edge
Functions, the client, CI/CD. It deliberately did not re-litigate what the phase-7 list already
tracks; everything here is a finding that list did **not** carry.

Branch: `phase-8-audit-fixes`, cut from `phase-7-production-harden` so PR #4 keeps its held state
and its 16-migration deploy queue is untouched.

Gate on every commit (husky pre-commit runs typecheck + the full suite):

- `tsc --noEmit` clean · `eslint .` clean
- `vitest run --coverage` — **630 passed / 2 skipped**, every per-glob threshold holds
- `npm audit --omit=dev --audit-level=high` — 0 high in the tree that ships
- `node scripts/db-migration-test.mjs` — 25 migrations, 3 seed files, **66 checks**, green

---

## Week 1 — see what is happening, and stop the bleeding

**`resolver: cache the catalogue prompt instead of re-billing it every call`** (`0dfc281`)
The system prompt is the entire catalogue, identical for every caller, rebuilt only every
`CATALOGUE_TTL_MS` — and it was sent as a plain string, so it was charged as fresh input tokens on
every classification. That made the 50,000-calls/day ceiling in migration `...0004` a ceiling on
requests, not on money. One `cache_control` breakpoint at the end of the block turns it into a cache
read. The provider's ephemeral cache TTL is 5 minutes, which is exactly `CATALOGUE_TTL_MS`; noted at
both ends so the two stay equal. Verified `TextBlockParam.cache_control` exists in the pinned
`@anthropic-ai/sdk@0.39.0` rather than assuming it.

**`auth: the session moves to the Keychain, and brings the old one with it`** (`ea040b6`)
The refresh token was in AsyncStorage — an unencrypted file in the app container. With no login and
no step-up auth that token _is_ the identity: whoever reads it reads the journal and can call
`delete-account`, which is irreversible and unrecoverable because there is no email to restore from.
Now `expo-secure-store`, with chunking (SecureStore warns above 2048 bytes; a real session exceeds
it), the chunk count written **last** so a torn write reads as "no session" rather than a partial
one, and `AFTER_FIRST_UNLOCK` because the SDK refreshes tokens with the device locked.

The migration half matters as much as the move: a miss consults AsyncStorage, adopts what it finds
and deletes the plaintext copy. Without it an upgrade would sign the user in as a **brand new
anonymous user** and orphan their journal under an id the device had forgotten. 13 tests.

**`entitlements: the refresh writes through the same guarded RPC as the webhook`** (`e8d0a37`)
`entitlements` had two write paths with different guarantees. The webhook goes through
`apply_entitlement_event`, which orders by RC event timestamp and dedupes by event id;
`entitlement-refresh` did a raw upsert that honoured neither and omitted `event_id`/`event_ts_ms`, so
a refresh left the row describing its own state under the _previous_ event's ordering key. On a
paying customer that reads as Plus silently coming and going.

**`privacy: refuse the account delete when its audit row does not land`** (`fa4b598`)
Migration `...0012` exists so an erasure leaves evidence. The insert's error was discarded and the
hard delete ran anyway — producing exactly what the table was added to prevent.

**`app: a failed boot no longer sticks for the life of the process`** (`b00fc89`)
`services()` memoised the promise from `build()` whether it resolved or rejected, so one transient
failure was cached forever and the user's only recovery was force-quitting an app that gave no sign
of why it was dead.

**`ci: pin the Supabase CLI`** (`584ebf8`) — `version: latest` on a job that runs `db push` against
production.

## Week 2 — make the deploy survivable, and make the gates real

**`sync: keyset pagination, so a bulk write cannot lose rows on the way down`** (`c3093b5`)
The down-sync paged with an offset `.range()` over rows ordered by `updated_at` alone. That order is
not total — a day flushed from offline, or the adoption re-home, stamps many rows inside the same
millisecond — so rows sharing a value could fall either side of a page boundary and be skipped.
`pullTable` then advanced its watermark past them and they were never pulled again: silent,
permanent loss, surfacing as "my journal is gone" after a reinstall.

`(updated_at, primary key)` is total, and a keyset cursor over a total order cannot skip or repeat a
row. The watermark became a `SyncCursor {updatedAt, key}` under a new `meta` key, so a device holding
the old bare timestamp does one full pull instead of parsing it as JSON — costly, never wrong. The
page walk is `collectKeyset` in `src/db/sync.ts`, away from the Supabase client, because it is the
part that was wrong and the part that needs testing; `services.ts` supplies only the PostgREST half.
Ten tests against the real loop, not a mock of it.

Same defect class as `5b6c0fa`, which gave local entry queries a total order. The network pull kept it.

**`db: prove cross-user RLS in CI, not in a test nobody runs`** (`4b1aba0`)
`test/rls-cross-user.test.ts` is opt-in behind `RLS_TEST=1` and had therefore never run in CI. It
cannot run in the migration harness either — it drives supabase-js auth, and the container has
Postgres but no GoTrue. So the property is asserted where it lives, in the policies, against the full
migration chain: `psqlAs()` runs SQL as `authenticated` with the uid in the request GUCs `auth.uid()`
reads, inside a rolled-back transaction.

28 checks. Two are worth more than the rest. The **definer sweep** is generic — every
`SECURITY DEFINER` function must have `EXECUTE` revoked from both client roles — because naming them
individually only re-checks the ones we remembered, and `reap_resolver_state` is in the tree
precisely because one was missed for a week. Its mirror asserts the four `SECURITY INVOKER` sync RPCs
stay callable, so an over-broad revoke cannot break every push instead. And the insert-denial test
has a **positive control** running the identical statement for its own owner; without it a typo would
also raise and the test would pass while proving nothing.

Verified by sabotage before committing: a permissive `using (true)` on `entries` makes it read 2
instead of 1; the same on `resolution_cache` makes it read 1 instead of 0 — the exact policy that
shipped and lived four days until migration `...0010`; granting execute on the reaper makes the sweep
name it. All three go red.

**`ci: put a human in front of the production migration, and smoke-test the deploy`** (`8b9ff42`)
A merge pushed migrations to the live project with nothing in between, and nothing then checked the
deploy had produced a working system. An `environment: production` key gives Required reviewers
somewhere to attach, and an unauthenticated POST to each of the four functions must be refused —
proving it deployed, it boots, and it still requires auth. `verify_jwt` is declared in
`config.toml` but applied by the platform, and a function silently accepting anonymous callers is the
worst outcome of a bad deploy rather than the most visible one.

## Week 3 — cost, abuse, and fairness

Four migrations (`...20260729000001`–`4`). Every guard here only fires under attack, which is
exactly the code that rots unnoticed, so each one is asserted in the harness with a positive control
beside it.

**`resolver: split the budget by tier, and stop serialising it on one row`** (`4451e1c`)
One 50,000/day fuse for everybody, and users are free and anonymous: forty throwaway sign-ups at 30
calls/min sustain 1,200/min and drain the day in under an hour, from one laptop, after which every
paying subscriber's resolver is dead until 00:00 UTC. Plus now draws from a reserved pool free
traffic cannot reach — `resolver-classify` was already reading the authoritative entitlement and
discarding it with `void isPlus`. The counter is also sharded 32 ways: it was a single row taking
`calls = calls + 1` on every served call, and Postgres serialises writers to a row, so that row was
the product's throughput ceiling with the lock wait inside the user's latency budget.
**FLAG(nirmal):** 40,000 free + 20,000 Plus are guesses exactly as 50,000 was.

**`resolver: make the cache-poisoning quorum cost something`** (`f486f42`)
The quorum was "3 distinct users agree", and an account is one `signInAnonymously()` call. Now: 5;
only accounts older than 24h count; the observations must span an hour; and a **contested phrase —
distinct refs from eligible accounts — promotes neither**, because disagreement is the signal
something is being steered and the attacker cannot suppress the honest observations. Contested
phrases are exposed as a view for an alert to watch once observability exists.

Rejected: requiring the phrase to share a token with the dish name or aliases. It would reject
`bhaat` → rice, which is the Hinglish mapping the resolver exists to perform. Not solved: an attacker
who prepares aged accounts and paces them — that needs a signal this schema does not have.

**`sync: bound the push payload, on both sides of the wire`** (`0cbb5df`)
`sync_upsert_entries(rows jsonb)` took an unbounded array — one RPC carrying five million rows is one
statement expanding jsonb on the primary while holding locks. `sync_guard` caps all four RPCs at 500
and raises rather than truncating; entries also caps 500 per user per day. **`pushDirty` now chunks**,
which is not optional given the cap: a device back from a long offline stretch can hold more than one
batch, and without chunking that push would raise forever and the journal would never reach the
server. Residual, stated not hidden: lifetime rows are still uncapped.

**`db: reap abandoned anonymous accounts`** (`595e2af`)
Every install mints a permanent `auth.users` row and nothing removed it — MAU billing, unbounded
growth, and (now that the quorum counts account age) a free ripening stock of aged accounts. Deletes
only: no email, no entries, no weights, no entitlements row even lapsed, and created _and_ last seen
over 90 days ago. **FLAG(nirmal):** 90 days is a retention line and the privacy notice has no
retention section; decide the number and the notice together.

---

## Blocked, and why

1. **`environment: production` needs its reviewers set.** The key is in the workflow; the gate is a
   repo setting. Settings → Environments → production → Required reviewers. Until that is done
   GitHub runs the job unguarded, exactly as before.
2. **OTA updates / client rollback (audit M8) — blocked on `eas init`.** `expo-updates` needs
   `updates.url` = `https://u.expo.dev/<projectId>`, and `app.json` has no `extra.eas.projectId`
   because `eas init` has never run (phase-7 item 4). Writing a placeholder id would reproduce the
   `REPLACE_WITH_*` pattern this audit flagged, so nothing was written. Until this lands, a
   crash-on-launch regression can only be fixed by a new binary through App Store review.
   The `channel` keys already in `eas.json` are inert without the package.
3. **Preview-branch DB in PRs — not added.** `supabase branches` needs a paid plan and the GitHub
   integration; adding a CI step that cannot be run or verified from here would be the same sin as a
   placeholder. The migration harness plus the new RLS gate cover the "does this SQL work" half; what
   a branch DB adds is "does it work against _your project's_ drift", which is phase-7 item 2's
   one remaining apply.
4. **The backup restore is still unchecked** (`docs/ops-verification.md`, phase-7 item 8). It is the
   highest-value item on that page and the reason the deploy approval above matters. A backup never
   restored is a hope.

## Week 4 — see it, and stop paying for an idle app

**`functions: structured logs, so a bad day is visible before the bill is`** (`1592d5a`)
None of the four functions emitted anything, so every guard added in Weeks 1–3 fired invisibly. One
JSON line per request from a `done` helper, so the response and the log are produced together and
cannot drift. `LogFields` is a closed type for the same reason `AnalyticsEvent` is: there is no
`log(event, arbitraryObject)`, because that signature is how `raw_text` reaches a log aggregator by
accident. Error messages are classified to a kind, never logged — a provider error can quote the
prompt back, and the prompt is the user's line.

`resolver-classify` now reports what a call **cost**. The number to watch is `cachedTokens` against
`inputTokens`: it is the direct health check on the `cache_control` breakpoint from `0dfc281`, and if
the cached share stops being most of the total then spend has regressed with nothing else looking
wrong — the exact failure a calls/day ceiling cannot see.

**`app: a real crash boundary, with the journal stripped off every event`** (`3c7eb56`)
`report.ts` was a `console.error` behind `__DEV__`, so release builds reported nothing. Now inert
until `EXPO_PUBLIC_SENTRY_DSN` is set, same guarded-require shape as `analytics.ts`. `scrubEvent` is
an **allow-list**, not a deny-list — the next SDK version can add a field carrying user content, and
a deny-list would not know to remove it. Breadcrumbs are never collected at all, because the resolver
POSTs the user's line and a fetch breadcrumb of that call _is_ the journal. Eleven tests, the
important ones negative.

**`sync: stop paying for a journal that has not changed`** (`3bd8de4`)
Boot awaited a full download of every reference table, every launch. Now backgrounded and gated on
`app_config.reference_version`, so an unchanged catalogue costs one small row read. The tick was a
flat 30s interval running a push plus four paged selects regardless; it now backs off 30s→5m while
idle and snaps back on any activity. An idle hour costs under 20 polls instead of 120.

**`privacy: name Open Food Facts, and pin the placeholder URLs`** (`a2db7e2`)
Every scanned barcode that misses our own table goes to a French non-profit with the user's IP, and
the processors section did not say so. The placeholder guardrail earned itself immediately: the audit
named two, the first run found **three** — `src/components/Drawer.tsx` puts `slate.app` in front of a
user's friends via the share sheet.

---

## Still open

- **Alerting** — the logs exist now; nothing watches them. Budget %, 5xx rate per function, webhook
  `upsert_failed`, and `resolver_contested_phrases` going non-empty are the four worth a page.
  Needs a destination, which needs the Sentry and PostHog accounts.
- **Sentry and PostHog remain unconfigured.** Both boundaries are written, tested and inert. Each is
  one `npm i` and one env var.
- **M12** the reference corpus is readable by anyone who installs.
- **C1 candidate filtering** — deferred deliberately. Prompt caching took most of the cost, and at 50
  dishes the catalogue is small; filtering matters once the dish table reaches 400–600, and doing it
  before then would tune against the wrong distribution.
