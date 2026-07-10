# 09 — Edge Cases, Offline, Safety

The reference app has 54 screenshots and not one error state. Every screen assumes the resolver works and the network is up.

Your users are on the Vadodara metro. It won't be.

---

## The line state machine

```
        ┌─────────┐
        │  draft  │  user is typing
        └────┬────┘
             │ blur / return
             ▼
        ┌───────────┐
        │ resolving │  shimmer running
        └─────┬─────┘
              │
      ┌───────┴────────┐
      ▼                ▼
┌──────────┐    ┌────────────┐
│ resolved │    │ unresolved │
└──────────┘    └─────┬──────┘
                      │ tap, or connectivity returns
                      └──► resolving
```

**`unresolved` never blocks the next line.** The text stays. A small `↻` sits where the number would be. The user keeps typing.

---

## Offline

1. Entry is written to SQLite immediately, with a client-generated UUID, `status = 'resolving'`
2. Resolver call fails → `status = 'unresolved'`, queued
3. Connectivity returns → queue drains, oldest first, rate-limited
4. Numbers backfill into their lines; header total and summary card recompute

The day's total shows what's resolved, with a quiet `+2 pending` when entries are queued. Never show a wrong total. Never show a spinner over the whole screen.

**Test on airplane mode before calling any logging work done.** Type five lines with no network, force-quit, reopen, restore connectivity. All five must resolve, in order, with the right totals.

---

## Resolver failures

| Case | Behaviour |
|---|---|
| Confidence < 0.6 | `unresolved`. Tap → `Not sure what this is. Try adding detail?` |
| No catalogue match | `unresolved`. Never snap to the nearest neighbour. |
| Malformed JSON | `unresolved`. Log to PostHog. Never regex numbers out of prose. |
| Timeout (>3s) | `unresolved`, queued for retry |
| Rate limit | Queue, exponential backoff, no user-facing error |

A wrong match is worse than no match. An `unresolved` line is honest. A silently mismatched line teaches the user to distrust every number in the app.

Track `unresolved_rate` as a first-class metric. Above 5% and the catalogue has a hole.

---

## Onboarding data before a user exists

BMR, kitchen, units, and goal are all collected before `Start`. The Supabase anonymous session is created at install, so `auth.uid()` exists — but verify it before writing.

If the anonymous sign-in failed (offline install), hold onboarding state in local storage and flush to `profiles` + `kitchen` in one transaction the moment a session exists.

**Test this on airplane mode too.** A user who signs in on a slow network must not land on a journal with a zero goal.

---

## Weight edge cases

- New weight differs from stored by **> 5kg** → inline confirm before writing
- Two weights on one day → last one wins, `unique (user_id, log_date)`
- Weight logged before BMR was set → store it, and offer to complete BMR
- `85` alone → treated as food, not weight. Ambiguous. Never guess.

---

## Exercise edge cases

- Exercise logged while `weight_is_assumed = true` → prompt once, inline: `How much do you weigh? We need it to work out the burn.` One field. Then compute.
- Exercise that would drive net below the floor → compute honestly, **display** at the floor, store the true value
- Same exercise logged twice → both count. Don't dedupe. People do two workouts.

---

## Backdating

- Pull down → scrubber → any past date. Entries write to `log_date`, not `created_at`.
- Free tier: 30 days back. Beyond that, the scrubber shows a Plus row.
- Future dates: Plus only. Free users see today and backwards.

---

## Steps, water, and sleep edge cases

**Steps**
- Under 3,000 in a day → contributes **0 kcal**. Show `✓`, not `-0`. Tapping the line explains: `The first 3,000 steps are already in your baseline.`
- Logged twice in a day → **last one wins**, not the sum. Nobody means "9,000 more steps"; they mean "actually, 9,000."
- `steps` + ambulatory exercise on the same day → count the larger, mark the smaller `included` with `✓`. Both lines stay visible. Neither is deleted.
- Logged while `weight_is_assumed` → same inline weight prompt as exercise.
- Apple Health steps import (Plus) writes a steps entry with `source = 'health'`; a manual line on the same day supersedes it.

**Water**
- No calories, ever. `✓` in the journal, a total in Stats.
- `1 glass` = 250ml, a Slate constant. Not a calibration question.
- Logged many times a day → these **sum**. Water is the one intent where repetition is additive, because that's how drinking works.

**Sleep** *(Plus)*
- No calorie effect. Stores `raw_text` and a duration where one parses.
- A free user tapping the Sleep card sees the paywall, not a broken toggle.
- `Slept badly` parses to no duration and that's fine. Store the text.

---

## Safety

These are not features. They are the conditions under which we're allowed to ship a calorie app.

### Net floor

Displayed net never below **1,200 kcal**. Store the true number, show the floor. The summary card never celebrates a low net — no green ring, no "great day," no congratulations for eating little.

### Goal floor

`calorie_goal` accepts a minimum of **1,200**. Below that, the field shows a plain message: `Slate can't set a goal below 1,200 calories.` No lecture, no link, no modal. It simply doesn't accept the number.

### Hide calorie counts

Free. Hides every calorie figure — journal lines, header, summary card, stats. Macros, fiber, and sugar remain. The journal still works; it just doesn't count at you.

### No outcome gamification

No badges. No goal streaks. No "12 days under budget." Nothing that rewards eating less or makes *stopping restricting* feel like failure.

**The one exception: the logging streak** (`02-SCREENS.md` §E0). It counts days with any entry — a single chai qualifies — and never touches calories, goals, or being under. Its own guardrails: backdating repairs it, breaking is silent, no streak notifications, no streak copy beyond the numbers. A streak of *writing* builds the habit that makes the data honest; a streak of *outcomes* builds the pressure that makes people hide food from their own journal. Slate has the first and will never have the second.

### Language

Never "you have X calories remaining" framed as permission. `1,610 cals left` is a fact. `You can still eat 1,610 calories!` is an instruction. See `brand/BRAND-VOICE.md`.

---

## Empty states

Written as invitations, not apologies.

| Screen | Copy |
|---|---|
| Journal, day 1 | `Write a food...` (placeholder only, nothing else) |
| Saved foods | `Add a nickname to a journal entry to save it.` |
| Weight chart | `No weight entries yet` |
| Stats, no data | Grey skeleton bars. No text. |
| History, free tier limit | `Slate Plus keeps your full history.` One row, no image. |

---

## Failure copy

Errors don't apologise and are never vague.

- `Couldn't reach Slate. Your entries are saved and will fill in.`
- `Not sure what this is. Try adding detail?`
- `That barcode isn't in our database yet. Try the label scanner.`
- `We need your weight to work out exercise burn.`
