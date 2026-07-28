# Analytics handoff: PostHog constraints

Decisions here were made 10 Jul 2026 with the founder; do not relax them without re-opening the DPDP review. Every constraint below traces to `spec/08-PRIVACY-DPDP.md` or to a founder decision recorded in `MASTER.md`.

**Status, 29 Jul 2026: the boundary is built.** `src/lib/analytics.ts` implements every rule on this page and `src/lib/analytics.test.ts` asserts them, including the two that are compliance rather than behaviour — the pinned host and the replay flags. What remains is not code:

|                |                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Built          | The boundary module, the closed event union, `screenOf` / `confidenceBucket` / `signinDeferral`, the bounded pre-init queue, `identify(auth.uid())` with no traits, inert-without-key, and every call site in the table below. |
| Not built      | `npm i posthog-react-native`. The module is loaded through a guarded `require`, exactly like `revenuecat.ts`, so until the package exists analytics is inert and nothing throws.                                               |
| Blocked on you | A self-hosted PostHog in `ap-south-1` to point `EXPO_PUBLIC_POSTHOG_HOST` at, the DPDP processor terms, and the privacy-notice line naming the processor. See `launch-gate.md`.                                                |

Installing the SDK before the host exists would only let events queue toward nowhere, so it is deliberately last.

---

## Host

Self-hosted PostHog in `ap-south-1` (Mumbai). Never PostHog US Cloud, never PostHog EU Cloud. This is a founder decision and it follows the data-residency posture in `spec/08-PRIVACY-DPDP.md`: Slate's data stays in India.

- The SDK host must be pinned via `EXPO_PUBLIC_POSTHOG_HOST`.
- The build must fail loudly if `EXPO_PUBLIC_POSTHOG_API_KEY` is present but the host is missing. A key with a default host silently ships data to PostHog's cloud, which is exactly the failure this rule exists to prevent.

## No autocapture, no session recording

The journal is a free-text health surface. Autocapture and session recording would exfiltrate `raw_text` wholesale. Both stay off, permanently, in SDK config, not as a dashboard setting someone can flip.

Explicit capture calls only.

## `raw_text` never leaves

`spec/08-PRIVACY-DPDP.md`: "Analytics never sees `raw_text`. Resolved `ref` only." This is non-negotiable.

Enforce it by construction, not by review:

- A single boundary module, `src/lib/analytics.ts`, is the only file that touches the PostHog SDK.
- It exposes a typed event union. There is no free-form `capture(name, props)` export. If a call site can pass an arbitrary string, the boundary has failed.
- No event payload field may carry entry text, normalized text, or nicknames. Not truncated, not hashed, not "for debugging".

## Identity

`identify(auth.uid())` only. No PII traits: no name, no email, no age, sex, height, or weight. This is the same id RevenueCat is aliased to, so purchases and product events line up without a second identifier.

## Gating

The SDK is inert when `EXPO_PUBLIC_POSTHOG_API_KEY` is absent. Mirror the require-guard pattern in `src/lib/revenuecat.ts`: the module loads, every exported function is a no-op, nothing throws, nothing logs noise.

## The event set, as built

From the week-8 dashboard needs in `spec/10-BUILD-PLAN.md` (`unresolved_rate` and resolver p95). The union in `analytics.ts` is the authority; this table is the map to where each one fires.

| Event                      | Properties                                                   | Fired from                                                                   |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `entry_resolved`           | `intent`, `ref`, `confidence_bucket`, `resolve_ms`, `source` | `services.ts` `resolveAndTrack`, wrapping the store's `resolveText`          |
| `entry_unresolved`         | `normalized_len`                                             | same                                                                         |
| `screen_viewed`            | `screen`                                                     | `app/_layout.tsx` `ScreenTracker`, off the router's own pathname             |
| `paywall_viewed`           | `gate`                                                       | `app/paywall.tsx` on mount                                                   |
| `purchase_completed`       | `plan`                                                       | `app/paywall.tsx`, on a purchase that actually granted Plus — not on restore |
| `export_run`               | none                                                         | `exportShare.ts`, after the share sheet                                      |
| `delete_run`               | none                                                         | `deleteAccount.ts`, after the server confirms and before the wipe            |
| `resolver_retry_exhausted` | none                                                         | `journal/store.ts`                                                           |
| `anon_signin_deferred`     | `reason`                                                     | `supabase.ts`                                                                |
| `sync_failed`              | `consecutive`                                                | `syncHealth.ts`, once on crossing the threshold                              |

Three things in that table are deliberate and were not obvious:

- `source` (`cache` / `rules` / `model`) was added because it is the cost signal. spec/05 puts the cache hit rate above 90%; `model` is the only value that spends money, and there was no way to see it.
- `entry_resolved` carries no entry id and `resolver_retry_exhausted` carries none either, though the code used to send one. An entry id joins to the row holding `raw_text`, which is the thing spec/08 keeps out of analytics.
- `anon_signin_deferred` used to send the Supabase error message verbatim. A message can carry the project ref or a request id, so it is classified into a fixed set (`offline` / `rate_limited` / `rejected` / `unknown`) by `signinDeferral()`.

`entry_unresolved` carries the length of the normalized text, never the text itself. `confidence` is bucketed, never sent raw: a float paired with a timestamp narrows down which line was typed.

`screenOf()` returns `null` for an unrecognised route rather than the path, so a route added later goes untracked instead of shipping a path — which can carry query params, which can carry anything. Every settings sub-page collapses to `settings` for the same reason.

## Before go-live

- [ ] Self-hosted PostHog running in `ap-south-1`, its URL in `EXPO_PUBLIC_POSTHOG_HOST`.
- [ ] `npm i posthog-react-native`. Nothing else changes — the guarded require in `analytics.ts` picks it up.
- [ ] The analytics processor is named in the O0 privacy notice and in `docs/privacy-policy-draft.md`.
- [ ] DPDP processor terms reviewed by counsel.
- [ ] Any wizard-generated code (if a PR exists from the PostHog setup wizard) is discarded, not merged. Wizard output enables autocapture by default and does not respect the boundary module.
- [ ] Confirm on a device build that no event fires when `EXPO_PUBLIC_POSTHOG_API_KEY` is unset. The unit tests cover the logic; only a device proves the native module behaves.
- [ ] After the first day of real events, read the `screen_viewed` values and check none is a raw path — that would mean `screenOf` fell through where it should have returned null.

## Still open: crash reporting

Sentry is a separate decision and is **not** built. `src/lib/report.ts` is still a dev-only console sink with a `TODO(C1)`. Note what is written there before wiring it: an unfiltered Sentry event carries more of the journal than any analytics event would, so `beforeSend` must drop the request body and strip breadcrumbs, and `sendDefaultPii` stays false.
