# Analytics handoff: PostHog constraints

DRAFT — handoff to the analytics developer. Decisions here were made 10 Jul 2026 with the founder; do not relax them without re-opening the DPDP review.

PostHog was cut from phase 6. This document is the contract for whoever implements it later. Every constraint below traces to `spec/08-PRIVACY-DPDP.md` or to a founder decision recorded in `MASTER.md`. Read both before writing code.

---

## Host

Self-hosted PostHog in `ap-south-1` (Mumbai). Never PostHog US Cloud, never PostHog EU Cloud. This is a founder decision and it follows the data-residency posture in `spec/08-PRIVACY-DPDP.md`: Slate's data stays in India.

- The SDK host must be pinned via `EXPO_PUBLIC_POSTHOG_HOST`.
- The build must fail loudly if `EXPO_PUBLIC_POSTHOG_KEY` is present but the host is missing. A key with a default host silently ships data to PostHog's cloud, which is exactly the failure this rule exists to prevent.

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

The SDK is inert when `EXPO_PUBLIC_POSTHOG_KEY` is absent. Mirror the require-guard pattern in `src/lib/revenuecat.ts`: the module loads, every exported function is a no-op, nothing throws, nothing logs noise.

## Suggested event set

From the week-8 dashboard needs in `spec/10-BUILD-PLAN.md` (`unresolved_rate` and resolver p95):

| Event                | Properties                                         |
| -------------------- | -------------------------------------------------- |
| `entry_resolved`     | `intent`, `ref`, `confidence_bucket`, `resolve_ms` |
| `entry_unresolved`   | `normalized_len`                                   |
| `screen_viewed`      | `screen`                                           |
| `paywall_viewed`     | `gate`                                             |
| `purchase_completed` | `plan`                                             |
| `export_run`         | none                                               |
| `delete_run`         | none                                               |

Note `entry_unresolved` carries the length of the normalized text, never the text itself.

## Before go-live

- [ ] The analytics processor is named in the O0 privacy notice and in `docs/privacy-policy-draft.md`.
- [ ] DPDP processor terms reviewed by counsel.
- [ ] Any wizard-generated code (if a PR exists from the PostHog setup wizard) is discarded, not merged. Wizard output enables autocapture by default and does not respect the boundary module.
- [ ] Confirm on a device build that no event fires when `EXPO_PUBLIC_POSTHOG_KEY` is unset.
