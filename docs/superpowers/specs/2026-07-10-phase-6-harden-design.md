# Phase 6 — Harden (design)

Date: 2026-07-10
Branch: `phase-6-harden` (off `phase-5-rest-of-app`)
Plan reference: `you-are-building-slate-unified-wigderson.md` Phase 6; `spec/10-BUILD-PLAN.md` Week 8.

## Goal

Make every shipped screen safe and usable at the accessibility extremes, prove the
safety guardrails in tests (not by eye), review security against the standing posture,
and produce an honest punch list. Gate = the punch list itself.

## Out of scope (deferred, tracked on punch list)

- **PostHog analytics** — handed to the developer. Constraints captured in
  `docs/analytics-handoff.md` so the DPDP analysis is not re-derived: self-hosted
  PostHog in `ap-south-1`, no autocapture, `raw_text` impossible by construction
  (typed event union, no free-form capture), gated behind an env key. Not built here.
- **TestFlight upload** — needs Apple Developer org + a real-device build (founder half).
- **Privacy policy publish, grievance officer name** — founder + counsel decisions.
  I draft skeletons; founders finalize and publish.
- **Resolver p95 dashboard** — depends on analytics; deferred with PostHog.

## The one-sentence test

Nothing here adds a feature, a screen, or a sound. Hardening only removes ways the app
can fail (wrapping numbers, mute VoiceOver, motion on reduced-motion, an un-caught
banned word). It cannot make the app slower to open or louder. Compliant by nature.

---

## Workstream 1 — Dynamic Type to xxLarge

**Rule (spec/03 line 144):** the journal line reflows; the number must not wrap.

- Add `numberProps` to `src/theme/type.ts`: `{ numberOfLines: 1, maxFontSizeMultiplier, adjustsFontSizeToFit: true }`.
  `maxFontSizeMultiplier` chosen so a six-digit tabular value (e.g. `2,610`) stays on one
  line at xxLarge inside the right-hand column width. One import, no scattered magic numbers.
- Apply `numberProps` to every number `Text`: `JournalLine` (kcal/burn/included), `SummaryCard`
  (cals / goal / left), Stats `hero-number`, history rows, weight rows.
- Body / label / caption text keeps scaling freely (`allowFontScaling` default true) — only
  numbers are capped, because only numbers carry the no-wrap constraint.
- Verify: drive the app at xxLarge on web/simulator where reachable; screenshot the journal
  line + summary card. Real-device xxLarge pass is the founder half (noted on punch list).

**Isolation:** `numberProps` is a pure typed style object; consumers import it, don't reimplement.

## Workstream 2 — VoiceOver single-utterance

**Rule (spec/03 line 148-149):** a journal line reads as one utterance
(`"2 rotis, 220 calories"`), not two. Every icon button has an `accessibilityLabel`.

- `JournalLine` already composes a single label via `accessibilityFor` — keep, add a test
  asserting the composed string for each `display.kind`.
- `SummaryCard` must read as one utterance (`"1,610 calories left, 790 of 2,400"`), the card
  is one `accessible` node — not per-fragment children each announcing.
- Audit every screen (grep found gaps): every `Pressable`/icon button gets an
  `accessibilityLabel` + `accessibilityRole`. Drawer, DayScrubber, header buttons, sheet close,
  scanner controls, settings rows.
- No decorative element is focusable (`accessibilityElementsHidden` / `importantForAccessibility`
  on the shimmer and pure-visual views).

## Workstream 3 — Reduced motion

**Rule (spec/03 line 147):** `prefers-reduced-motion` disables shimmer and settle; sheet uses
platform default (unaffected).

- `Shimmer` + `SettledNumber` already honor `useReducedMotion`. Extract the hook to
  `src/theme/motion.ts` if it lives only in `Shimmer.tsx`, so other Animated call sites share it.
- Audit Phase-5 Animated usage (Drawer slide, segmented-control spring, stats range change,
  scrubber). Each: reduced → static end-state, no interpolation.
- Test: `SettledNumber` with reduced=true sets value to 1 immediately (no timing). Assert.

## Workstream 4 — Guardrail re-verify (as tests, CI-enforced)

The guardrails were built in earlier phases. Phase 6 pins them with tests that fail CI on
regression — the plan names "grep for banned brand-voice words" explicitly (Phase 6 §).

- **Net floor 1,200 at the display layer:** assert `displayNet` (stats/aggregate) and the
  value `SummaryCard` renders are both `max(net, 1200)`. Engine floor test exists; this adds
  the display-layer assertion so a future UI change can't bypass it.
- **Goal floor:** goal field + macro-goals reject `< 1200` with the exact spec copy. Test the
  rejection message string, not just the boolean.
- **Banned brand-voice words:** `test/guardrails/brand-voice.test.ts` greps all UI copy source
  (`app/**`, `src/components/**`) for the banned set from `brand/BRAND-VOICE.md`:
  `wellness, journey, transform, fuel, nourish, mindful, guilt-free, cheat meal, earn,
burn off, smash, crush, healthy`, and the standalone word `just`. Fails CI on any hit.
  Allowance: matches inside comments/identifiers that are not user-facing copy are excluded by
  scoping the grep to string literals rendered in JSX where feasible; where not cleanly
  separable, the test lists explicit reviewed exceptions with a reason (kept minimal).
- **No celebration:** assert no macro/positive color is keyed to a low or under-goal net —
  over-goal and under-goal render the same weight/color (spec brand-voice §2).

## Workstream 5 — Security review + docs + punch list

- **Security self-review** (Opus subagent, per model-split memory) against the standing Step-2
  posture in the plan: RLS + cross-user, no service-role in client, Edge Function JWT+zod+rate,
  LLM boundary untrusted both ways, `raw_text` never to analytics (now trivially true — no
  analytics), `resolution_cache` no `user_id`, secrets git-ignored, `npm audit`. Report:
  what an attacker could do with what Phase 5 shipped, and what stops them.
- **Draft docs** (founders + counsel finalize):
  - `docs/breach-playbook.md` — who declares, the 72-hour DPDP notification, reaching users
    without email (in-app banner + App Store update note). Per spec/08 §6.
  - `docs/app-store-listing.md` — listing copy leading with "No login. No coaches. No sales calls."
    (plan line 130) and the spec/08 promise line.
  - `docs/analytics-handoff.md` — the PostHog constraints for the developer (above).
  - Privacy-policy skeleton — the spec/08 §1 itemized notice, marked DRAFT / counsel-review.
- **Punch list** — the gate deliverable. Honest three-column: verified-in-code /
  owed-to-real-device-half / blocked-on-founder-or-counsel. Includes the PR-targeting note
  (phase-6 targets phase-5 branch until PR #1 merges).

---

## Verification per workstream

| Workstream      | How verified                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Dynamic Type    | Vitest where pure (`numberProps` shape); screenshot at xxLarge on reachable target; real-device on punch list     |
| VoiceOver       | Unit test on `accessibilityFor`; manual audit checklist of every icon button; real-device VoiceOver on punch list |
| Reduced motion  | Unit test `SettledNumber`/hook reduced=true path; audit checklist                                                 |
| Guardrails      | CI-enforced tests (floor, goal floor, banned words, no-celebration) — red first                                   |
| Security + docs | Opus subagent review report in the PR; docs committed; punch list committed                                       |

## Testing posture

TDD for the guardrail tests (red first — write the banned-word test, confirm it can fail by
temporarily planting a banned word, then confirm green). A11y/motion changes are edits to
existing tested components; add assertions for the new behavior, keep coverage gates
(engine/resolver 100%, others as-is).

## Definition of done (the gate)

Honest written punch list committed, `tsc`/eslint clean, all tests pass, coverage gates hold,
security review report in the PR, draft docs committed. Then stop for founder go before any
TestFlight / merge action.
