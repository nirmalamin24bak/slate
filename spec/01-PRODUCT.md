# 01 — Product

## The problem

Every calorie app in India fails at the same place, and it isn't the interface.

- Searching "biryani" in MyFitnessPal returns dozens of user-submitted entries ranging from 280 to 800 kcal. No way to know which is right.
- A katori is not a unit. Small is 100–150ml, standard 150–200ml, restaurant 250–300ml.
- A roti is 25g or 50g depending on whose house you're in. That's 60 kcal or 160.
- Hidden cooking oil is the largest single error source. One tbsp is ~120 kcal. A family sabzi carries 3–4 tbsp before a vegetable goes in.
- Two sugars across four cups of chai is 200+ kcal nobody logs.
- Restaurant food runs 30–40% above the home equivalent.

Nobody solves this by having a bigger database. HealthifyMe has 100,000 entries and still can't tell you how much oil is in *your* dal.

## The insight

**Calibrate the household, not the database.**

Four questions, asked once, fix every home-cooked estimate forever: how big is your katori, how big is your roti, how long does a litre of oil last and for how many people, how do you take your chai and coffee.

That is Slate's moat. The dish table can be rebuilt by anyone. The kitchen calibration cannot be bought.

## The second insight

**The absence of search is the accuracy feature.**

Slate never shows a list of 47 biryanis. You type a line. One number comes back, from a curated table with recipe lineage we can defend. Freeform input isn't a UX flourish — it's how we avoid crowd-sourced rot.

## Principles

**Instruments, not instructions.** We show BMR. We show the sedentary baseline. We do not suggest a goal. The user does the arithmetic and owns the result.

**The numbers are honest about being estimates.** Onboarding says so before the user has typed anything. A ±20% error that's *consistent* still produces an honest weekly trend. Consistency beats precision.

**Every feature is off until asked for.** Slate opens as a calorie box. Exercise, weight, fiber, sugar — all real, all switched off. The user turns on what they need.

**Nothing between the user and the line.** No submit button. No confirmation. No modal. Type, and keep typing.

## Target user

Urban Indian, 24–35, iPhone, English-comfortable, types Hinglish without thinking about it. Has tried MyFitnessPal and quit. Has been pitched a HealthifyMe coaching plan and resented it.

## Scope: v1

### In

- Freeform text journal — food, exercise, weight, water, steps in one input
- "What you can write" — a teaching hub that reveals each intent and toggles it on
- Logging streak (counts the act of writing, never the contents)
- Kitchen calibration (katori, roti, oil, chai, coffee)
- BMR screen, ICMR-adjusted
- Barcode scanner, nutrition label scanner
- Macros (protein, carbs, fat), fiber, sugar
- Stats — week / month / year / range
- Saved foods (via nickname)
- Hide calorie counts
- Export data
- Widgets (lock screen, home screen)
- Dark mode

### Out — decided, not deferred by accident

| Cut | Why |
|---|---|
| **Micronutrients** | Iron, B12, folate carry absorption error we cannot honestly display. See `06-NUTRITION-ENGINE.md`. |
| **Health categories** (Immunity, Inflammation, Skin, Mental health) | Nothing in a food log supports an inflammation score. |
| **Voice mode** | Not load-bearing. |
| **"Learn about this food"** | Not load-bearing. |
| **Outcome gamification** (badges, goal streaks, "12 days under budget") | Wrong pressure for this category. The one exception: a *logging* streak, which rewards writing, not restricting. See `02-SCREENS.md` §E0 for its guardrails. |
| **Coaches, meal plans, human anything** | This is the thing users hate about the incumbents. |
| **Android** | v1 is iOS. Revisit after 5k installs. |

### Plus tier (v1)

Stats · Fiber & sugar · Kitchen calibration *(contested — see 07)* · Saved foods · Widgets · Photo logging · Chat · Apple Health import · Full history · Custom dishes

Free keeps the complete journal: logging (all three intents), macros, streak, hide-calories, export, 30-day history. See `07-MONETIZATION.md`.

## Positioning

> No login. No coaches. No sales calls. Purchases go through Apple, so refunds do too.

Every one of those lines is a direct answer to a one-star review of a competitor. Use them in the App Store description verbatim.
