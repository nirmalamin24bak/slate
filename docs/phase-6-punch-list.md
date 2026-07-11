# Phase 6 — Harden: punch list (the honest gate)

Status: **gate reached, awaiting founder go.** This is the deliverable that closes Phase 6. Do not open the Phase 6 PR, merge, or start TestFlight work without an explicit go from Nirmal or Nehal.

Branch: `phase-6-harden` (HEAD `daee1c2`, off `phase-5-rest-of-app`).
Gate run 2026-07-11: `tsc --noEmit` clean, `eslint .` clean, `vitest run --coverage` — **393 passed / 2 skipped**, every coverage threshold holds (`src/components/a11y.ts` at 100/100/100/100; overall statements 97.61%, branches 90.6%, functions 98.3%, lines 98.66%). Security self-review (Opus, full branch): **zero findings Medium or above.**

---

## Verified in code this phase (with how)

- **Banned brand-voice words + em-dash:** CI test greps UI copy (string literals + JSX text) across `app/**/*.tsx`, `src/components/**/*.tsx`, `src/onboarding/draft.ts` — `test/guardrails/brand-voice.test.ts`. Fixed live copy hits during the task; one em-dash that straddled a `{expr}` (invisible to the literal/JSX-text scan) caught by hand and reworded (`4b61000`).
- **Net floor 1,200 + goal floor + exact rejection copy:** CI test pins `displayNet` never below `NET_FLOOR_KCAL` across the input space, empty day composes to the floor, `isValidGoal(1199)=false`/`(1200)=true`, and the rejection sentence is byte-exact and single-sourced — `test/guardrails/floors.test.ts`.
- **No-celebration:** palette pinned closed by test (light/dark carry exactly the six spec/03 tokens; macros are the only semantic colours; accent is the spec indigo) — a low or over-goal net has no celebratory colour to key to. Over-goal caption fixed to `cals over` at the same grey and size as any other day (`fd15c43`).
- **Dynamic Type — numbers never wrap:** `numberProps` (`numberOfLines: 1` + `maxFontSizeMultiplier: 1.35`) applied at all 40 number sites (`type.number`/`type.heroNumber`); grep reconciled 40/40 (`c340c52`). `adjustsFontSizeToFit` deliberately omitted — per-Text shrink would desynchronise column figures and break tabular discipline.
- **VoiceOver single-utterance:** journal line and summary card compose to one utterance each, pinned by test in the pure module `src/components/a11y.ts` (100% coverage); hide-calories mode drops the number from the label, not just the visual (`02b57e4`). Six audited role/label/state gaps fixed: day-header role, calendar ISO date label + selected state, drawer scrim role, sheet backdrop role, retry-button explicit label over the bare `↻` glyph; Segmented selected-state verified already present (`2fd5eb3`).
- **Reduced motion:** both Animated call sites (shimmer, number settle) honor `prefers-reduced-motion`; the hook is extracted to `src/components/useReducedMotion.ts` so future call sites import the module, not a consumer; grep confirmed no other animation and no stale importer (`1f82c65`).
- **Phase-6 draft docs written and voice-checked:** `docs/analytics-handoff.md`, `docs/breach-playbook.md`, `docs/app-store-listing.md`, `docs/privacy-policy-draft.md` (`daee1c2`). Each opens with its DRAFT status line; all four passed a hand voice-check (the guardrail test does not scan `docs/`) and the security review (no secrets, no compliance over-promise).

## Owed to the real-device half (Nirmal)

The Node suite cannot exercise iOS-render or native props; these need a device or simulator:

- xxLarge Dynamic Type walkthrough on device (journal, stats, settings, onboarding) — confirm no number wraps or ellipsizes.
- VoiceOver pass on device: journal line reads as one utterance by ear; drawer, sheets, calendar cells, retry button, scanner.
- Reduced-motion setting flipped on device: shimmer static, number settle instant.
- Airplane-mode re-pass across every flow (spec/10 wk8): the automated journal test exists; onboarding, scanner, and export flows still need the device.
- On-device halves still open from Phases 3–5: recordings; purchase/restore; scanner camera; export share sheet; delete flow.

## Blocked on founders / counsel / external

- **PostHog analytics:** the whole workstream, handed to the developer via `docs/analytics-handoff.md`. The week-8 `unresolved_rate` + resolver-p95 dashboard depends on it. (PostHog was cut from Phase 6 by decision.)
- **Privacy policy publish** (`docs/privacy-policy-draft.md`): counsel review, plus two founder/counsel placeholders — the **resolver model-provider name** (still a pending founder decision) and the **DPDP section citations** (§11/§12/§13 need confirmation against the notified Rules).
- **Breach playbook finalization** (`docs/breach-playbook.md`): founders fill the named decision-owner and deputy placeholders.
- **App Store listing finalization** (`docs/app-store-listing.md`): founders finalize wording.
- **TestFlight:** Apple org, EAS build, testers.
- **SQLite / AsyncStorage at-rest encryption decision** (carried from Phase 5, DPDP) — decide with counsel.
- **Resolver:** provider key → live eval → Edge Function deploys (`resolver-classify`, `delete-account`) — carried from Phases 2/5.
- **PR mechanics:** PR #1 (phase-5) is open and unmerged; this branch targets `phase-5-rest-of-app` until #1 merges, then rebases to `main`.

## Security review — Informational (tracked, not blocking)

- **INFO-1:** `npm audit` reports 0 high / 0 critical, 12 moderate — all one transitive root, `uuid <11.1.1` (GHSA-w5hq-g745-h8pq) reached through the Expo build toolchain (`expo` → `@expo/cli` → `@expo/config-plugins` → `xcode`). Build-time only, not shipped runtime; no app code path feeds attacker input to it. Fix is a breaking `expo-splash-screen@55` bump — defer to a coordinated Expo SDK upgrade, do not `npm audit fix --force`.
- **INFO-2:** the em-dash guardrail allowlists a copy string whose entire trimmed value is a bare `—` (the empty-state null glyph). Intended and tested, but a future string that is _only_ an em-dash would escape the rule. Benign; noted for awareness.

## Minor findings logged for final whole-branch review triage

- `test/guardrails/brand-voice.test.ts`: the JSX-text regex splits text around `{expr}` interpolations, so a banned phrase straddling an interpolation is missed (this is the gap that let the weight-confirm em-dash through until it was caught by hand). Worth a comment noting the limit, or a second pass that concatenates across interpolations.
- `src/components/a11y.ts`: the `check` display kind reads via the `switch` default arm (plan-mandated shape). A future `LineDisplay` variant would silently read ", logged" until pinned. An explicit `case 'check':` plus a `satisfies never` default would make an omission a compile error.
