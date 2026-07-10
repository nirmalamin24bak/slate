# 06 — Nutrition Engine

Pure functions. No network. No model. Deterministic.

---

## Three layers

**1. Ingredient ground truth** — IFCT 2017 (National Institute of Nutrition, Hyderabad). ~528 foods, per 100g, Indian varieties. The only defensible base. Ingredients, not dishes.

**2. Dishes as recipes** — "Poha" isn't a food. It's 60g flattened rice + 5ml oil + peanuts + onion. Compute nutrition from layer 1. Every dish number has lineage.

This is a month of real work and it *is* the moat. Regionalise where it matters: Gujarati poha has sugar, Indori poha has sev.

**3. Portion vocabulary** — the actual accuracy lever. Nobody eats "150g dal." They eat one katori.

---

## Kitchen calibration

The four questions from `O7`, applied.

### Katori

| Setting | ml |
|---|---|
| Small | 150 |
| Standard | 200 |
| Large | 250 |

A katori of dal is 100–150 kcal at 150ml, and 50% more at 250ml. Same word, same dish, different house.

### Roti

| Setting | Ø | flour | kcal |
|---|---|---|---|
| Small (phulka) | 6″ | 25g | 60–80 |
| Medium | 8″ | 35g | 90–110 |
| Large / restaurant | 10″ | 50g | 130–160 |

`"2 rotis"` is 120 kcal or 320 kcal. Not an estimation problem — an unasked question.

### Oil — the bottle heuristic

```
daily_oil_ml_per_person = oil_bottle_ml / oil_bottle_days / household_size
```

A 1L bottle over 30 days for 4 people ≈ **8.3 ml/person/day ≈ 75 kcal/day**.

Applied to every entry where `dishes.is_home_cookable = true` and `context = 'home'`, distributed proportionally across that day's home-cooked entries by their base `cooking_fat_ml` weight.

One tbsp of any cooking oil — sunflower, mustard, coconut, olive — is roughly 120 kcal. A family sabzi carrying 3–4 tbsp is 360–480 kcal before a vegetable enters the pan. Per katori that's 90–120 kcal that no app counts.

This calculation is *checkable by the user against their own kitchen*. That's what makes it honest.

### Chai and coffee

Two sugars across four or five cups daily is over 200 hidden calories. Ask once.

```
chai_kcal  = tea_base(5)
           + milk_kcal(chai_milk, 60ml)
           + chai_sugar_tsp * 16

coffee_kcal = coffee_base(2)
            + milk_kcal(coffee_milk, 60ml)
            + coffee_sugar_tsp * 16
```

Milk per 60ml: `none 0` · `toned 35` · `full 45`
Filter coffee decoction: add 5 kcal, assume 100ml milk unless specified.

A chai with one sugar and toned milk is ~55 kcal. With two sugars and full-fat, ~92. The reference app logs "one cup tea" at 40. That number is the entire reason Slate exists.

### Restaurant context

`context = 'outside'` → `cooking_fat_ml × 1.35`, `portion × 1.20`. Kitchen calibration does not apply.

Restaurant palak paneer is ~380 kcal per katori against home's ~280.

---

## Computation

```ts
function computeEntry(r: Resolution, kitchen: Kitchen, p: Profile): Nutrition {
  const dish = dishes[r.ref];
  const grams = toGrams(r.qty, r.unit, dish, kitchen);   // katori → ml → g

  let n = sumIngredients(dish, grams);                    // from IFCT

  if (dish.is_home_cookable) {
    const oil = r.context === 'outside'
      ? dish.cooking_fat_ml * 1.35
      : kitchen.dailyOilPerPerson * dish.oil_share;
    n = addOil(n, oil);
  }

  if (r.context === 'outside') n = scale(n, 1.20);

  return clampPersonalization(n, p.personalization);      // ±20% total, ±30% fat
}
```

`toGrams` is the only place unit conversion happens. It reads `kitchen`. It is pure.

---

## BMR

**Mifflin-St Jeor, reduced 10%.**

```
male:    (10 × kg) + (6.25 × cm) − (5 × age) + 5
female:  (10 × kg) + (6.25 × cm) − (5 × age) − 161

BMR = raw × 0.90
```

### Why the 0.90

ICMR-NIN's 2020 Expert Group on Nutrient Requirements found that international standard equations overestimate BMR for Indians by 10–12%, because the FAO/WHO/UNU dataset drew on young, muscular subjects while Indian body composition carries relatively more fat. The previous committee applied a 5% reduction; the 2020 committee reviewed the evidence and went to 10%.

On a raw BMR of 2,000 that is 200 kcal a day. Over a year it is the difference between a real deficit and wondering why nothing happened. Every competitor ships the unadjusted Western formula.

Source: ICMR-NIN, *Nutrient Requirements for Indians — RDA and EAR, 2020*.

### Baseline

```
baseline = BMR × 1.2      // sedentary. always.
```

**Do not apply an activity multiplier.** Slate subtracts logged exercise from the day's budget explicitly. If the baseline already contained an activity factor, every workout would be counted twice. Movement earns its credit by being logged.

This single decision keeps the model coherent.

---

## Exercise

Compendium of Physical Activities. MET values, public, fine to use.

```
kcal = MET × 3.5 × weight_kg / 200 × minutes
```

Requires body weight. If `profiles.weight_is_assumed`, prompt once, inline, at the first exercise log. Ask at the moment it matters.

A 5k jog is ~-320 kcal at 70kg and ~-410 at 90kg. The reference app shows one number for everyone.

### The floor

```ts
const net = Math.max(consumed - burned, 0);
const displayNet = Math.max(net, FLOOR);   // FLOOR = 1200
```

Exercise credits back into the budget. The displayed net never drops below 1,200 kcal, and the summary card never celebrates a low net — no green ring, no "great day," nothing.

It costs one `Math.max()`. It is the difference between a tracker and a machine for people who should not be using one.

---

## Steps

A step counter and an exercise log measure the same legs. Getting this wrong is the easiest way to hand someone 600 phantom calories.

### The baseline already contains steps

`baseline = BMR × 1.2`. That 1.2 sedentary factor is not "lying in bed." It covers incidental daily movement — walking to the car, around the office, to the kitchen — plus the thermic effect of food and non-exercise thermogenesis. In practice, roughly **the first 3,000 steps of the day**.

So:

```
billable_steps = max(0, steps − 3000)
kcal_per_step  = 0.045 × (weight_kg / 70)
steps_burn     = billable_steps × kcal_per_step
```

A 9,000-step day at 85kg: `6000 × 0.055 ≈ 330 kcal`. A 2,500-step day: **zero**, and Slate says so rather than showing `-0`.

The reference app tells users steps *"work best over 3,000"* and never explains why. Slate explains it on the teach sheet. It costs one sentence and saves a support thread.

`0.045 kcal/step` is an engineering default, not a measured constant. Flag it for revision once real data exists.

### The double-count rule

`9000 steps` and `45 min walk` on the same day are one walk described twice.

When a `steps` entry coexists with an **ambulatory** exercise (walk, jog, run, hike, treadmill — flag these in `exercises.is_ambulatory`):

```
day_movement_burn = max(steps_burn, ambulatory_exercise_burn)
```

Count the larger. Show the smaller with a `✓` and the label `included`, not a number. Non-ambulatory exercise (weights, yoga, swimming, cycling) adds on top, unaffected.

The user sees both lines they wrote. Neither is deleted. Only one is counted. That is honest, visible, and requires no explanation.

### The floor still applies

Steps subtract from the day's budget exactly like exercise, and hit the same `Math.max(net, 1200)`. A 20,000-step day does not unlock 800 extra calories on the display.

---

## Water

No calories. No macros. No nutrition math at all.

```
1 glass  = 250 ml     (Slate constant, not a calibration field)
1 litre  = 1000 ml
```

Renders `✓` in the journal. Sums to a daily total in Stats. That is the entire feature.

Four calibration questions is the ceiling. A fifth ("how big is your glass?") turns a screen into a form.

---

## Sleep

Does nothing. Stores `raw_text` and a parsed duration where one exists. Feeds Chat's context window and nothing else. No calorie effect, no stats card in v1.

It exists because Chat is better with it, and Chat is Plus, so the sleep card is Plus. If Chat ships without consuming sleep, delete this intent rather than let it sit there implying a relationship it doesn't have.

---

## Micronutrients: cut, and here is why

Not imprecision. **Directional error.**

Protein in dal is predictable — lentil mass in, protein out, ±10%. The chemistry does not care how you cooked it.

Iron does not work that way. IFCT reports *total* iron. What matters is *absorbed* iron. Non-heme iron from a typical Indian vegetarian meal absorbs at roughly 3–5%, against 15–18% for heme iron. Phytates in dal and roti bind it. Tea with the meal binds more — and your users drink tea with the meal. Vitamin C unbinds some. Cook in an iron kadhai and the food gains iron that appears in no table.

So Slate would display **"Iron: 18mg — 100% of RDA"** to a vegetarian woman who is functionally iron deficient. That is not an imprecise number. It is a false reassurance about a condition affecting a very large share of exactly the demographic we are building for.

Same shape of problem with B12 (near-zero in a lacto-veg diet regardless of the table), folate (degrades with cooking), vitamin D (barely comes from food).

A caveat does not fix this. Nobody reads the caveat. They read the green checkmark.

**Ship instead: fiber and sugar.** They survive cooking. They have no absorption story. They are in IFCT. And for a population with India's diabetes prevalence, they are the two numbers that actually matter.

The hole in Plus is filled by **custom dishes** — the user defines *"Mummy's dal"* once, with their ingredients and their oil, and it becomes a first-class entry they can type forever. Cheap to build. The most requested feature in every Indian tracker's reviews. And it improves our dish table with every user who adds one.

---

## Honesty about accuracy

We will not be accurate. Restaurant oil alone swings a dish 40%.

Target **±20%**, and optimise for **consistency** instead. If a user's poha is always 270 kcal, their weekly trend is honest even when the absolute number is soft. Trends change behaviour. Precision is theatre.

Onboarding screen `O5` says this out loud, before the user has typed anything. That is not a disclaimer. It is the product's position.
