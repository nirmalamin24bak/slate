# Phase 8 — Audit fixes: punch list

Status: **weeks 1 and 2 of the remediation plan are landed; the launch gate in
[`phase-7-punch-list.md`](phase-7-punch-list.md) is unchanged.** This phase closes findings from a
production-readiness audit run on 29 Jul 2026 against the whole tree — 20 migrations, 4 Edge
Functions, the client, CI/CD. It deliberately did not re-litigate what the phase-7 list already
tracks; everything here is a finding that list did **not** carry.

Branch: `phase-8-audit-fixes`, cut from `phase-7-production-harden` so PR #4 keeps its held state
and its 16-migration deploy queue is untouched.

Gate on every commit (husky pre-commit runs typecheck + the full suite):

- `tsc --noEmit` clean · `eslint .` clean
- `vitest run --coverage` — **610 passed / 2 skipped**, every per-glob threshold holds
- `npm audit --omit=dev --audit-level=high` — 0 high in the tree that ships
- `node scripts/db-migration-test.mjs` — 20 migrations, 3 seed files, **28 RLS checks**, green

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

## Still open from the audit, not started

Ranked as the audit ranked them. These are Weeks 3–4 of the remediation plan.

- **C8 observability** — no structured logs in any Edge Function, `report.ts` still carries its
  `TODO(C1)` where Sentry goes, analytics inert. Every other risk here is undetectable until a bill
  or a review arrives. Note what is written beside the TODO before wiring: an unfiltered Sentry event
  carries more of the journal than any analytics event would.
- **C3 shared budget fuse** — one 50k/day pool for everyone; ~40 free anonymous accounts drain it in
  under an hour and the resolver is dead for paying users until UTC midnight. `resolver-classify`
  already computes `isPlus` at `index.ts:238` and then discards it (`void isPlus`); wiring it into a
  reserved pool is most of the fix.
- **C2 Sybil-defeatable cache quorum** — the anti-poisoning defence is "3 distinct users agree", and
  a distinct user costs one `signInAnonymously()`. Layer account age, temporal spread, and a
  plausibility gate against `supabase/seed/dish-bands.json`, which already exists and is unused here.
- **C7 unbounded sync payload / no per-user row quota.**
- **M2** single hot `resolver_global_budget` row · **M4** boot-blocking full reference pull ·
  **M5** unconditional 30-second sync tick · **M7** Open Food Facts is called with every scanned
  barcode and is not a named processor in the privacy notice · **M10** Settings links to
  `https://slate.app/privacy`, a domain we do not own · **M12** the reference corpus is readable by
  anyone who installs · **M14** no anonymous-account reaper.
