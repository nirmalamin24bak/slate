# MASTER — Every decision, and why

Nirmal: read this when you're about to change something. The reasons matter more than the decisions. If a reason no longer holds, change the decision. If you can't remember the reason, don't.

Last updated: 9 July 2026.

---

## Identity

| Decision | Reasoning |
|---|---|
| Name: **Slate** | A flat stone you write on and wipe clean. Carries no opinion about what you wrote. |
| Parent: **Sonal Systems Private Limited**, Vadodara | Existing entity. |
| **Not a Mist clone** | Layout, IA, and interaction model are copied — those aren't protectable and Mist's structure is good. Typeface and palette are Slate's own. Identical type + identical layout + same category = trade dress exposure, and App Store guideline 4.1 (copycats) can be applied on sight. You're mid-trademark-filing; don't hand anyone that. |
| Typeface: **Inter Tight** | Same posture as the reference — tight grotesque, heavy display cut, negative tracking. Proper tabular figures. Free (OFL). Reads identical at a glance, isn't the same face. |

---

## Platform & stack

| Decision | Reasoning |
|---|---|
| **iOS only for v1** | Focus. Revisit Android after 5k installs. |
| React Native (Expo), TypeScript, Supabase, RevenueCat, PostHog, EAS | Same stack as See & Saw. Basanth already knows it. |
| Supabase region **`ap-south-1`** (Mumbai) | DPDP data residency. Cannot be changed after project creation. |
| SQLite local read source, Supabase truth | The journal must open instantly and work on the metro. |
| Sync built into the **first migration** | UUID PKs, `updated_at`, soft deletes, last-write-wins. Retrofitting sync onto a local-only app is a rewrite. Most common mistake in this category. |

---

## Auth — reversed twice, final

| Decision | Reasoning |
|---|---|
| **No login screen. Ever.** | A wall costs installs. A Google Play reviewer of a competitor described logging their first meal, moving through six onboarding cards, then being forced onto a paid plan — and called it a scam. |
| **Supabase anonymous sign-in at install** | Real `auth.users` row, stable `user_id`, RLS from day one. No screen, no friction. |
| Sign-in is an **offer** in Settings, not a gate | Apple or Google, upgrading the same row in place. No migration, nothing lost. |
| **Paying requires no account** | On iOS the entitlement attaches to the Apple ID via StoreKit. RevenueCat anon ID aliased to `auth.uid()`. Restore Purchases works across reinstall and devices. |
| Named failure mode | Reinstall → subscription restores, food log doesn't. That's *why* Settings offers sign-in. It is not a reason to build a wall. |
| Settings shows **Delete my data**, not Log out | There's nothing to log out of. |

> *Original decision was a login wall at `Start`. Nirmal reversed it. Correct call.*

---

## Onboarding

Two chapters: teach (5 screens), set up (4). One required input.

| Decision | Reasoning |
|---|---|
| **DPDP privacy notice first**, before anything is collected | Legal obligation, and it costs one screen. |
| Teaching screens come **before** any input | The reference app does this and it's why it feels light. Every competitor front-loads a 12-step interrogation. |
| **Screen O5 says the numbers are ±20% wrong** | Honest, and it pre-empts the one-star review that says our numbers are wrong. |
| **BMR screen added** (age, sex, height, weight) | Needed for exercise burn and for the user to reason about a goal. Skippable. |
| On skip, **no BMR number is shown** | We don't know their sex; a fabricated BMR is worse than none. Fallback weight 65kg, `is_assumed = true`, only so exercise math doesn't crash. First exercise log prompts for weight inline. |
| **"Your kitchen" screen added** (katori, roti, oil, chai, coffee) | The moat. See below. |
| **No goal recommendation.** Empty field. | *Instruments, not instructions.* Every app that quietly picks a deficit for someone is making a medical decision it isn't qualified to make. |
| Units: kg/cm with ft-in toggle. Canonical storage always cm/kg. | Conversion at the input boundary only. Otherwise your weight chart grows a cliff. |
| Under-18: no BMR, no numbers | DPDP requires verifiable parental consent for children's data. We avoid the regime by not collecting it. |
| **Paywall immediately after Start**, dismissible | Mirrors the reference. Free tier is generous enough that this isn't hostile. |

---

## The journal

| Decision | Reasoning |
|---|---|
| **The journal is a multiline text editor.** Each line is an entry. | No submit button, no confirmation, no modal. Type, and keep typing. |
| Line states: `draft → resolving → resolved \| unresolved` | The reference app has 54 screenshots and zero error states. Your users are on the metro. |
| Shimmer under a resolving line, number lands right-aligned, tabular | Numbers must not jitter as they change. |
| **Six intents, not three — added 10 Jul 2026** | Reference screenshots revealed a teaching hub exposing food, exercise, weight, water, steps, sleep. Slate takes all six. `water` and `sleep` produce no number and render `✓`. Three of six intents are silent — that's what makes it a journal rather than a calculator. |
| **"What you can write" hub** | The reference calls this row *Track exercise and weight*, which undersells it: it's the only place a user discovers the text field accepts more than food, *and* the per-intent toggle. Renamed. Each card opens a teach sheet with three tappable examples; **tapping an example inserts it into the journal**. That single tap is the entire onboarding for that intent. |
| **⚠ Steps: the 3,000 threshold** | `baseline = BMR × 1.2` already contains incidental daily movement — roughly the first 3,000 steps. Counting all steps as burn would double-count against the baseline. `billable = max(0, steps − 3000)`, `kcal/step = 0.045 × (kg/70)`. The reference app says steps "work best over 3,000" without explaining why; Slate explains it on the teach sheet. `0.045` is an engineering default, flagged for revision against real data. |
| **⚠ Steps × ambulatory exercise: count the larger, never the sum** | `9000 steps` + `45 min walk` is one walk described twice. `exercises.is_ambulatory` flags walk/jog/run/hike/treadmill. Engine takes `max(steps_burn, ambulatory_burn)`; the smaller line stays visible marked `included` with `✓`. Non-ambulatory exercise (weights, yoga, swimming, cycling) adds on top. Nothing is deleted; only one thing is counted. This is the single easiest way to hand a user 600 phantom calories, and it is why the reference app's steps feature is a trap. |
| Steps hit the same **1,200 net floor** | A 20,000-step day does not unlock 800 display calories. |
| **Weight accepts conversational phrasing** | Screenshots show *I weigh 150 lbs*, *Currently, I'm at 68 kg*, *Weekly weigh-in is 130 lbs*. First-person body phrasing beats everything and makes the bare-number case less load-bearing. Bare mass → weight only with no food noun and 30–250kg. `2 kg chicken` is dinner. Bare integer is food. |
| **Water: `1 glass = 250ml`, a constant, not a calibration question** | Four kitchen questions is the ceiling. A fifth turns a screen into a form. Water sums across the day — the one intent where repetition is additive. Steps do not sum; last write wins. |
| **Sleep is Plus, and does nothing** | No calorie effect, no stats card. Stores text and a duration where one parses. Its only consumer is Chat, which is Plus. **If Chat ships without consuming sleep, delete the intent** rather than let it imply a relationship it doesn't have. |
| Exercise displays as **negative**, subtracts from the budget | Nirmal's call. See the guardrails below. |
| Weight is a **journal line** (`weight 85` / `85 kg`), not a tab | Discovered from the screenshots. Supersedes the earlier "separate tab" decision. |
| `85 kg` → weight only if no food noun and 30–250 range. `2 kg chicken` → food. `85` alone → food. | Never silently overwrite body weight. A wrong weight corrupts every future BMR and burn calculation. >5kg change prompts a confirm. |
| **Nickname a line to save it.** No favourites button. | Saving *is* renaming. One interaction, two jobs. |
| Suggestion strip above the keyboard | Recents and saved foods. Free. |
| Pull down on "Today" → day scrubber | Backdating is a swipe, not a date picker. |
| **Exercise, weight, fiber, sugar are OFF by default** | Slate ships as a calorie box and grows only when asked. This is how the reference app is minimal without being thin. |

---

## The resolver

| Decision | Reasoning |
|---|---|
| **The LLM never emits a calorie.** | It maps text → `{intent, ref, qty, unit}`. Nutrition comes from our tables. Deterministic, auditable, same input → same output forever. An LLM asked for calories produces a *different* plausible number tomorrow. |
| Cache `normalized_text` → resolution, globally | "2 roti" gets typed ten million times. Hit rate should exceed 90% within weeks. |
| **Cache the resolution, not the nutrition** | Nutrition depends on the user's kitchen. Cache the wrong layer and every user gets Nirmal's oil consumption. This distinction is the architecture. |
| Confidence < 0.6 → `unresolved`. Never snap to nearest neighbour. | A wrong match teaches the user to distrust every number. An unresolved line is honest. |
| `context: outside \| home` from one token | Restaurant food runs 30–40% above home. +35% fat, +20% portion. Largest accuracy win after calibration. |
| **Hinglish supported** | "2 roti aur ek katori dal" is how your users type. Splits into two entries at the resolver. |
| Personalization is a **bounded modifier** | Free text can shift cooking assumptions ±30% fat, ±20% total. It cannot override the dish table's base values. Someone who types "everything I eat is 50 calories" gets a slightly leaner poha, not a lie. Implemented as a clamp in the engine, not a prompt instruction the model can be argued out of. |
| Chat-profile fields (allergies, job, sleep) appear **only with Plus** | Don't make free users fill a form for a feature they can't reach. |

---

## Nutrition engine

| Decision | Reasoning |
|---|---|
| **IFCT 2017** (NIN Hyderabad) as ingredient ground truth | ~528 Indian foods, per 100g. The only defensible base. |
| **Dishes composed from recipes**, never hand-typed calories | Every number has lineage. Regionalise where it matters. 400–600 dishes at launch. A month of real work, and it's the moat. |
| **Kitchen calibration** — katori, roti, oil, chai, coffee | See below. |
| **BMR = Mifflin-St Jeor × 0.90** | ICMR-NIN 2020 found international equations overestimate Indian BMR by 10–12%, because the FAO/WHO/UNU dataset used young muscular subjects and Indian body composition carries relatively more fat. The prior committee used 5%; the 2020 committee moved to 10%. On a 2,000 BMR that's 200 kcal/day. Every competitor ships the raw Western formula. |
| **Baseline = BMR × 1.2 (sedentary). No activity multiplier.** | Slate subtracts logged exercise explicitly. If the baseline contained an activity factor, every workout would count twice. This one decision keeps the model coherent. |
| Exercise: MET × 3.5 × kg / 200 × minutes | Compendium of Physical Activities. Requires body weight — hence the BMR screen. |
| Nutrition **denormalised at write time**, with `calc_version` | If we fix a recipe in July, the user's June doesn't silently change. |
| **Target ±20%, optimise for consistency** | Restaurant oil alone swings a dish 40%. If a user's poha is always 270, their weekly trend is honest. Trends change behaviour. Precision is theatre. |

### Kitchen calibration — the moat

Four questions, asked once.

- **Katori**: 150 / 200 / 250 ml. Small vs large is a 50% swing on the same dal.
- **Roti**: 6″ 25g / 8″ 35g / 10″ 50g. "2 rotis" is 120 or 320 kcal. Not an estimation problem — an unasked question.
- **Oil**: *a 1L bottle lasts us ~30 days, cooking for 4 people* → 8.3 ml/person/day ≈ 75 kcal/day, distributed across home-cooked entries. One tbsp of any oil is ~120 kcal; a family sabzi carries 3–4 tbsp before a vegetable enters the pan.
- **Chai & coffee**: two sugars across four cups daily is 200+ hidden kcal. The reference app logs "one cup tea" at 40. For an Indian it's 90–110.

HealthifyMe has 100,000 food entries and cannot tell you how much oil is in *your* dal. The dish table can be rebuilt by anyone. The kitchen calibration cannot be bought.

---

## Safety — not features, conditions of shipping

| Decision | Reasoning |
|---|---|
| **Displayed net never below 1,200 kcal** | Store the true value, show the floor. One `Math.max()`. |
| **Summary card never celebrates a low net** | No green ring, no "great day." |
| **Goal field rejects anything below 1,200** | Plain message, no lecture. |
| **Hide calorie counts — free** | Nirmal initially gated it behind Plus. Reversed. Every other Plus feature is an upgrade; this one is the affordance that lets someone with a difficult relationship to numbers use the app at all. Charging ₹199 for it means the users who most need it don't get it. Nobody upgrades to see *less*. It's a boolean that hides a column. |
| **No outcome gamification** — badges, goal streaks, "under budget" runs | Makes stopping *restricting* feel like failure; this category's documented failure mode feeds on it. Amended 10 Jul 2026: a *logging* streak is permitted with strict guardrails (see Monetization block). Writing ≠ restricting. |
| Copy never grants permission | `1,610 cals left` is a fact. "You can still eat 1,610 calories!" is an instruction. |

One competitor's complaint board contains a user reporting hospitalisation on that app's diet plan, with their therapist saying it was causing an eating disorder. That is the category Slate is entering.

---

## Monetization

| Decision | Reasoning |
|---|---|
| **₹199/month, ₹1,499/year** (−37%) | Priced to be forgettable. HealthifyMe's coaching runs ₹999–1,699/month and its reviews are wall-to-wall refund disputes. |
| 7-day free trial on **yearly only** | |
| Apple IAP only, RevenueCat entitlements | Not Razorpay — that's for non-app-store contexts. |
| **Plus** = stats · fiber & sugar · kitchen calibration · saved foods · widgets · photo logging · chat · Apple Health · full history · custom dishes | Revised 10 Jul 2026: everything below macros in the original matrix moved to Plus, per Nirmal. Free = the complete journal (all three logging intents, macros, streak, hide-calories, export, 30-day history). |
| **⚠ Contested: kitchen calibration behind Plus** | Implemented as instructed, flagged: calibration is the *accuracy of the free tier's numbers*, not a capability. An uncalibrated free user gets numbers wrong the way every competitor's are — and writes that review. Plus should sell more capability, not less wrongness. One word reverses it. |
| Free history: **30 days**. Plus: full + future-dating. | Explicitly retained in the 10 Jul revision. |
| **Logging streak — added 10 Jul 2026** | Nirmal's call, and a defensible carve-out from the no-gamification rule: it counts days with ≥1 entry of any intent, never references calories or goals, backdating repairs it, breaking is silent (no copy, no notification, no repair offer). Rewards the act of writing, not the contents. Outcome gamification stays banned. Lives in the drawer; derived from `entries` at read time, no new table. |
| **Export is free** | DPDP makes it a right, not a feature. Charging for a legal obligation is a bad look and probably unlawful. |
| Refunds go through Apple | We don't hold the money and don't adjudicate. Say so in the store listing — it's the sharpest differentiator in the category. |
| No interstitials, no "3 of 5 free logs", no nagging | Free tier is the product. Plus is a tip with benefits. |

---

## Cut, deliberately

| Cut | Reasoning |
|---|---|
| **Micronutrients** | Not imprecision — *directional* error. IFCT reports total iron; what matters is absorbed iron. Non-heme absorbs at 3–5% vs 15–18% heme. Phytates in dal and roti bind it. Tea with the meal binds more, and your users drink tea with the meal. So Slate would show *"Iron: 18mg — 100% RDA"* to a vegetarian woman who is functionally iron deficient. Same shape for B12, folate, vitamin D. A caveat doesn't fix it: nobody reads the caveat, they read the green checkmark. |
| Replaced in Plus by **custom dishes** | "Mummy's dal" defined once. Cheap to build, most-requested feature in every Indian tracker's reviews, and it improves our dish table with every user. |
| **Fiber and sugar kept**, free | They survive cooking. No absorption story. In IFCT. And for India's diabetes prevalence, they're the two numbers that actually matter. |
| **Health categories** (Immunity, Inflammation, Skin, Mental health, Energy) | Nothing in a food log supports an inflammation score. The least defensible screen in the reference app. |
| **Voice mode** | Not load-bearing. |
| **"Learn about this food"** | Not load-bearing. |
| **Android** | v1 is iOS. |

---

## DPDP

DPDP Rules notified 14 Nov 2025. Hard enforcement **14 May 2027**, no expected grace period. Penalties to ₹250 crore for security-safeguard failures. We launch inside the build-and-test window — build it right now, don't retrofit.

Anonymity is not a shield. Age, sex, height, weight, and a food diary are personal data and health data. Sonal Systems is a Data Fiduciary regardless of whether a login screen exists.

Obligations, as work:
- Standalone itemised notice at first launch (screen O0)
- **Delete my data** — in-app, hard delete, cascade
- **Export your data** — free, JSON + CSV
- Named grievance officer, published
- 72-hour breach notification to the Board and to users — **write the playbook before launch**
- Retention policy; `resolution_cache` holds no `user_id`
- Data residency `ap-south-1`
- The resolver's model provider is a processor: zero-retention, no training on our data, named in the notice
- **`raw_text` never goes to analytics.** Resolved `ref` only.
- No ad SDKs, ever

*Not legal advice. Spend an hour with counsel before launch — same tier as the company registration and the TM filing.*

---

## What I'd still push on

Recorded so it isn't lost:

1. **Exercise-as-negative-calories** converts movement into a food allowance. The floor makes it survivable, but the underlying loop is the one that goes wrong for a subset of users. You chose it knowingly. Watch the reviews.
2. **The reference app is new** — developer Holograph, 5.0 stars from ~20 ratings. You are not late. You are also not copying a proven winner; you're copying a promising stranger. Their retention numbers are unknown to both of us.
3. **The dish table is not delegable to a model.** If it gets outsourced or generated, Slate becomes MyFitnessPal with better typography, and the entire thesis collapses.

---

## The one-sentence test

> If a change makes Slate slower to open, slower to type into, or louder, it is wrong — no matter how good the feature is.
