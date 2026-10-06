# CLAUDE.md — Slate

Read this first, every session. Then read `MASTER.md`. Do not begin work until you have both in context. Then read `HANDOVER.md` for where things stand.

---

## What Slate is

A calorie journal for urban Indians, 24–35. You type what you ate on a line. A number appears next to it. That's the app.

Built by Sonal Systems Private Limited, Vadodara. Founders: Nirmal and Nehal. Engineering: Basanth.

## The one-sentence test

> If a change makes Slate slower to open, slower to type into, or louder, it is wrong — no matter how good the feature is.

## Non-negotiables

These were decided deliberately. Do not "improve" them without asking.

1. **No login.** Supabase anonymous sign-in at install. No auth screen exists. Sign-in is an *offer* in Settings, never a gate.
2. **No goal recommendation.** Slate shows BMR and baseline. The user types their own calorie goal into an empty field. We give instruments, not instructions.
3. **The resolver never emits calories.** The LLM maps text → `{intent, item_id, qty, unit}`. Nutrition is computed from our tables. Always. A hallucinated number is a bug, not an estimate.
4. **Net calories never display below 1,200.** Exercise and steps credit back into the budget, but the floor holds and the UI never celebrates a low net.
5. **Steps above 3,000 only.** `baseline = BMR × 1.2` already contains the first ~3,000 steps. And `steps` never adds to an ambulatory exercise on the same day — take the larger, mark the other `included`. Read `spec/06-NUTRITION-ENGINE.md` before touching either.
6. **No micronutrients.** Fiber and sugar only. See `spec/06-NUTRITION-ENGINE.md` for why.
7. **No ads. No coaches. No meal plans. No outcome streaks.** (A *logging* streak exists, with guardrails. See `spec/02-SCREENS.md` §E0.)

## Stack

- React Native (Expo), TypeScript
- Supabase — Postgres, Auth (anonymous), Edge Functions, RLS. Region: `ap-south-1` (Mumbai).
- `expo-sqlite` as the on-device read source. Supabase is truth.
- RevenueCat for subscriptions. Apple IAP only.
- PostHog for product analytics. No third-party ad SDKs, ever.
- EAS for builds.

**iOS only for v1.** Android is a later decision, not a parallel track.

## Where things live

```
spec/01-PRODUCT.md          scope, principles, what's cut
spec/02-SCREENS.md          every screen, in order
spec/03-DESIGN-SYSTEM.md    tokens, type, spacing
spec/04-DATA-MODEL.md       schema, RLS, sync
spec/05-RESOLVER.md         the LLM contract
spec/06-NUTRITION-ENGINE.md IFCT, dishes, calibration, BMR, MET
spec/07-MONETIZATION.md     free/Plus, pricing, RevenueCat
spec/08-PRIVACY-DPDP.md     legal obligations, not features
spec/09-EDGE-CASES.md       offline, errors, safety
spec/10-BUILD-PLAN.md       8 weeks, in order
brand/BRAND-KIT.md          colour, type, logo, tone of surfaces
brand/BRAND-VOICE.md        how Slate talks
```

## How to work in this repo

- **Read the relevant spec file before writing code for that area.** They contain decisions with reasons attached. The reasons matter more than the decisions.
- **Small commits, one concern each.** Message format: `area: what changed`. e.g. `resolver: cache normalized phrases before LLM call`.
- **TypeScript strict mode. No `any`.** If you need an escape hatch, use `unknown` and narrow.
- **Every DB table gets RLS from the first migration.** Never "add RLS later."
- **Canonical units are `cm`, `kg`, `ml`, `g`.** Conversion happens at the input boundary and nowhere else.
- **Tabular figures on every number in the UI.** Numbers must not jitter as they change.
- **Test on airplane mode before calling any logging work done.** See `spec/09-EDGE-CASES.md`.

## What to do when a decision is unclear

Check `MASTER.md` first — it lists every decision made and why. If it isn't there, it wasn't decided. Ask Nirmal. Do not invent a default and ship it.

## What Slate is not

Not a coach. Not a nutritionist. Not a social network. Not a habit tracker. Not a wellness platform.

It is a notes app that knows about food.
