# 02 — Screens

Layout, spacing, and interaction follow the reference app closely. Typography and palette are Slate's own (`03-DESIGN-SYSTEM.md`).

---

## A. Onboarding

Two chapters. The progress bar shows this: a short filled pill for chapter one, a long track for chapter two.

**Chapter 1 — Teach (5 screens).** No input. Just Next.
**Chapter 2 — Set up (4 screens).** One required input.

Nothing is collected before the DPDP notice on O1.

### O0 — Privacy notice
First launch, before anything. Standalone, itemised: what Slate collects (age, sex, height, weight, food entries), why (to compute calories), that it's stored in India, that it can be deleted and exported from Settings. One button: **Continue**. Links to full policy.

### O1 — "Slate uses AI to work out nutrition for you."
Chip: `Half a bowl of poha` → ↓ → chip: `✦ 180 calories`

### O2 — "It combines several sources."
Chip: `1 katori dal` → ↓ → three cards: `IFCT 2017` / `Our recipes` / `Your kitchen` → ↓ → `140 calories ✓`

Note the third card. It's Slate's differentiator, stated on screen two.

### O3 — "Type anything, including exercise."
Scrollable list of example lines:

```
2 rotis                     220 cal
Chai with sugar             110 cal
5k jog                     -320 cal
1 katori rajma              180 cal
Vada pav                    290 cal
45 min weights             -190 cal
Masala dosa                 380 cal
```

The negative numbers are grey. This is where the user learns exercise lives in the same box.

### O4 — "Want to be precise? Add detail."
Chip: `Poha, 60g flattened rice, 1 tsp oil, peanuts` → `210 cal`
Grey subtext: `Or scan a barcode or label.`

### O5 — Honesty
Two icons, two statements.

> Nutrition labels are often 20% off, so don't stress over single calories.

> Use good estimates and adjust based on progress.

Link: `Research sources ↗`

This screen is not optional and does not get shortened. It pre-empts the one-star review that says our numbers are wrong, and it happens to be true.

### O6 — Your body *(skippable)*
Four fields, one screen: **age · sex · height · weight**

Units: kg / cm default. Toggle for ft-in. Canonical storage is always cm and kg.

On completion, shows two numbers and no advice:

```
BMR                    1,540
Sedentary baseline     1,850
```

**On skip:** show no BMR. The block reads `Set this up →`. Store a fallback body weight of 65kg flagged `is_assumed = true`, used only so exercise math doesn't crash. Never fabricate a BMR — we don't know their sex.

### O7 — Your kitchen *(skippable)*
The screen no competitor has. Four questions.

1. **Your katori** — Small (150ml) / Standard (200ml) / Large (250ml), with a visual
2. **Your roti** — Small 6″ / Medium 8″ / Large 10″
3. **Your oil** — `A 1L bottle lasts us about [30] days, cooking for [4] people.`
4. **Chai & coffee** — sugar (0/1/2 tsp), milk (none / toned / full-fat / filter coffee decoction)

Derived: per-person daily cooking fat ≈ `1000ml ÷ days ÷ people`. At 30 days / 4 people that's ~8.3ml ≈ 75 kcal/day, distributed across home-cooked entries.

Skipping uses population medians (200ml katori, 8″ roti, 30g/day oil, 1 tsp sugar, toned milk) flagged `is_assumed`.

### O8 — Your goal
Empty field. `cals`

Below it, the numbers from O6 restated small and grey. Nothing else. **No suggestion. No "we recommend."**

If O6 was skipped, this reads `Set up your body to see your baseline →`.

### O9 — Notifications
`Want Slate to remind you to journal?`
`No thanks` / `Enable reminders`

### O10 — Start
> **Enjoy.**
> Slate fits your life, whether you journal daily or once in a while.

Consistency graphic. Button: **Start**.

**Start goes straight to the journal.** No auth. Anonymous session was created silently at install.

### O11 — Paywall
Appears once, immediately after Start. Dismissible.

Free column: unlimited entries · barcode · label · macros · weight · exercise · streak · hide calories · export · 30-day history
Plus column: adds stats · fiber & sugar · kitchen calibration · saved foods · widgets · photo logging · chat · Apple Health · full history · custom dishes

`Monthly ₹199` · `Yearly ₹1,499` *(-37%)*
`Upgrade` · `No thanks`

---

## B. The journal (home)

The only chrome is two circular buttons: `=` top-left (drawer), scanner top-right.

```
=                                    ⛶

Today
790 cals

weight 85                            ✓
A bowl chicken fried rice           550
One cup chai                        110
2 rotis                             220
1 litre of water                     ✓
9000 steps                         -270

Write a food...




┌────────────────────────────────────┐
│ ◔  790 / 2400 cals    32g 98g 27g  │
│    1610 cals left  protein carbs fat│
└────────────────────────────────────┘
```

### The core interaction

The journal is a **multiline text editor**. Each line is an entry.

1. User types a line, hits return (or the line blurs)
2. A soft gradient shimmer runs beneath the line
3. The number lands, right-aligned, tabular
4. The header total and summary card recompute
5. Cursor is already on the next line

No submit button. No confirmation. No modal. Ever.

### Line states

`draft → resolving → resolved | unresolved`

See `09-EDGE-CASES.md` for `unresolved`.

### Interactions

- **Tap a line** → entry detail sheet: the text as an editable chip, `⋯` menu, calories, macros with percentages and a stacked bar
- **Nickname a line** → it becomes a saved food. There is no "favourite" button. Saving *is* renaming.
- **Suggestion strip** above the keyboard: recents and saved foods, one tap
- **Pull down on "Today"** → horizontal day scrubber (`View all history` · Tue · Wed · Today · `done`) and a `Go to today` pill
- **Summary card** → `Tap to view options` → bottom sheet

### Bottom sheet (from the summary card)

```
   Chat about your day  →        [Plus]

   Your info & goals              ›
   Your kitchen                   ›   [Plus]
   Customize display              ›
   Fiber and sugar                ›   [Plus]
   What you can write             ›
```

**Everything except food is OFF by default.** Slate ships as a calorie box and grows only when asked.

---

## G. "What you can write" — the teaching hub

The reference app calls this *Track exercise and weight*. That name undersells it. It's the only place a user discovers that the text field accepts more than food, and it's the toggle for each. Both jobs, one screen.

Tapping the row opens a list of intent cards. Tapping a card opens its **teach sheet**.

```
   🥣  Food                    always on
   🏃  Exercise                      ○
   〰  Weight                        ○
   💧  Water                         ○
   👣  Steps                         ○
   🌙  Sleep              [Plus]     ○
```

### Teach sheet — the pattern

Icon, title, one or two plain sentences, three tappable examples, a toggle, Done.

**Tapping an example inserts it into the journal and closes the sheet.** That's the pencil affordance in the reference. It converts reading into a logged entry in one tap, which is the entire onboarding for that intent.

### The six sheets

**🥣 Food** — always on, no toggle
> Write a food and get the calories and macros. Add detail to make it more precise.

`2 rotis` · `1 katori dal, less oil` · `Masala dosa`

**🏃 Exercise**
> Write exercises. Add time or intensity for a closer estimate.

`30 min jog` · `45 minutes of weights` · `1 hr yoga`

**〰 Weight**
> Write your current weight. It shows up in Stats.

`weight 72` · `I'm at 72 kg` · `Weekly weigh-in 71.5`

**💧 Water**
> Write how much water you drink.

`1 glass of water` · `1 litre of water` · `2 glasses`

**👣 Steps**
> Write any steps you take. Slate counts steps above 3,000 — the rest is already in your baseline.

`8000 steps` · `8k steps` · `12k steps`

**🌙 Sleep** *(Plus)*
> Write how you slept. Chat uses it for context. It doesn't affect your calories.

`7.5 hours of sleep` · `Woke up twice` · `Slept badly`

### Notes

The reference app's steps copy says it *"works best by recording steps over 3,000"* without explaining why. Slate says why: the sedentary baseline already contains those steps. Honesty is cheaper than mystery, and it pre-empts the "why didn't my 2,000 steps count" support email.

Sleep does nothing to the calorie math. It is a context line for Chat, which is Plus, so the card is Plus. If Chat ever ships without sleep consuming it, cut this card.

---

## C. Drawer (`=`)

```
Journal
Chat                    [Plus]
─────────
History
Streak
Stats                   [Plus]
Settings

  Share Slate with friends
```

---

## D. Scanner (⛶)

Segmented control at the bottom: `barcode` · `label` · `photo`

- **barcode** — free. Open Food Facts + our packaged-goods table.
- **label** — free. OCR a nutrition panel or a recipe.
- **photo** — Plus. Shows the teaser card (`Snap a food to get instant nutrition info` / `Try it out`) then routes to the paywall.

---

## E0. Streak

A streak of **logging**, and only of logging. It has no opinion about what was logged.

```
Streak

12
days

Longest    34 days

▮▮▮▯▮▮▮  ▮▮▮▮▮▮▯  ▮▮▮▮▮▮▮  ▮▮
```

**Rules — these are safety rules, not product taste:**

- A day counts when it has **≥1 non-deleted entry of any intent** (food, exercise, or weight). One chai is a logged day.
- The streak never references calories, goals, macros, or being under/over. It counts *the act of writing*, nothing else.
- **Backdating counts.** Fill in yesterday via the scrubber and yesterday is a logged day. A missed evening isn't a broken streak if you log it at breakfast. (Free tier: within the 30-day window.)
- **Breaking is silent.** The number resets. No "you lost your streak," no greyed-out flame, no repair offer, no notification. There is no streak-related copy anywhere except the two numbers and the dots.
- Day boundary: device timezone, midnight.
- Derived from `entries` at read time. No new table, no denormalised counter to drift.

The consistency dots reuse the `O10` graphic: filled = logged, hollow = not. Weeks group left to right, most recent on the right.

---

## E. Stats *(Plus)*

Free users see the screen with a single quiet row: `Slate Plus shows your trends.` No blurred fake charts.

Segmented: `Week` `Month` `Year` `Range`

Cards, in order: **Calories** (bar chart, average) · **Weight** (line, latest) · **Macros** (protein/carbs/fat, average, %) · **Fiber & sugar** *(if enabled)*

`Range` opens a calendar. `Tap a date twice to change the start date.`

Empty states: `No weight entries yet`

No "Health categories." No "Add chart."

---

## F. Settings

```
  Upgrade to Slate Plus

  Share the app             ›
  Your info & goals         ›
  Your kitchen              ›
  Widget                    ›
  Dark mode                 ›
  Send feedback             ›

  Privacy & terms   Delete my data
  support@slate.app
```

There is no **Log out**, because there is no login. `Delete my data` is a DPDP obligation, not a feature.

### Your info & goals

```
  Calorie goal          ›
  Macro goals           ›
  Your body (BMR)       ›
  Saved foods           ›
  Personalization       ›
  Apple Health          ›   [Plus]

        ↓ Export your data
```

**Export is free.** DPDP makes it a right.

### Personalization

Free-text box, injected into the resolver at calculation time:

> `I always cook with very little oil...`

Bounded. It can shift cooking assumptions ±30% on fat and ±20% on total calories. It cannot override the dish table's base values. See `05-RESOLVER.md`.

The chat-profile fields (allergies, health issues, job, sleep) appear **only when Plus is active**. Don't ask free users to fill a form for a feature they can't reach.

### Customize display

Toggles: `Show macros` · `Show fiber & sugar` · `Show exercise` · `Show weight` · `Show water` · `Show steps` · `Show sleep` · **`Hide calorie counts`**

Hide calorie counts is free, and stays free. It's the affordance that lets someone with a difficult relationship to numbers use the journal at all. Nobody upgrades to see less.

### Saved foods

Empty state: `Add a nickname to a journal entry to save it.`
