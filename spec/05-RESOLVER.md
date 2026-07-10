# 05 — The Resolver

The single most important component. Get this wrong and Slate is a random number generator with nice typography.

---

## The rule

> **The LLM never emits a calorie.**

It maps text → structure. Nutrition is computed from our tables, deterministically. Same input, same output, every time, forever.

An LLM asked for "calories in 2 rotis" will produce a plausible number. It will produce a *different* plausible number tomorrow. That's not an estimate, it's a hallucination with a unit attached.

---

## Pipeline

```
raw text
   │
   ├─ 1. normalize          lowercase, strip punctuation, collapse whitespace,
   │                        transliterate common Hinglish → canonical
   │
   ├─ 2. cache lookup       resolution_cache[normalized]  → hit? done.
   │
   ├─ 3. LLM classify       → { intent, ref, qty, unit, context, confidence }
   │
   ├─ 4. validate           ref must exist in dishes | exercises | packaged_foods
   │                        qty must be positive and sane
   │                        confidence >= 0.6, else → unresolved
   │
   ├─ 5. compute            nutrition engine (06). deterministic.
   │
   └─ 6. cache write        via Edge Function, service role
```

Steps 1, 2, 5 are pure functions. Only step 3 touches a model. Only step 3 can be wrong in an interesting way.

---

## Intents

Six. Plus a seventh for failure.

| Intent | Trigger | Destination | UI |
|---|---|---|---|
| `food` | Default | `dishes` / `packaged_foods` / `custom_dishes` | `+220` |
| `exercise` | Motion verbs, durations, distances | `exercises` → MET | `-320` grey |
| `weight` | Body-mass phrasing (see below) | `weights` + `profiles` | `✓` |
| `water` | Volume + water noun | `entries.qty_ml` | `✓` |
| `steps` | Integer + step noun | steps burn (see `06`) | `-270` grey |
| `sleep` *(Plus)* | Duration + sleep noun, or sleep quality phrasing | `entries.raw_text` only | `✓` |
| `unresolved` | Confidence < 0.6, or no ref match | nothing | retry affordance |

`water` and `sleep` never produce a number. They render `✓`, like `weight`. Three of the six intents are silent — that's the point of a journal.

### Weight disambiguation

The reference app accepts conversational weight lines — *I weigh 150 lbs*, *Currently, I'm at 68 kg*, *Weekly weigh-in is 130 lbs*. Slate must too, and that makes the bare-number case less load-bearing.

Ordered rules:

1. **First-person body phrasing wins.** `I weigh`, `I'm at`, `weigh-in`, `weight`, `my weight` + a mass → `weight`, high confidence, regardless of the number.
2. **Bare mass** (`85 kg`, `72kg`) → `weight` **only if** no food noun is present and 30 ≤ value ≤ 250.
3. **Food noun present** → `food`. `2 kg chicken` is dinner.
4. **Bare integer** (`85`) → `food`. Ambiguous. Never guess weight from a naked number.

**Never silently overwrite body weight.** When `weight` fires and the new value differs from stored by more than 5kg, show an inline confirm before writing. A wrong weight corrupts every future BMR and every future burn calculation.

### Steps disambiguation

`8k steps`, `8000 steps`, `12,000 steps` → `steps`. Parse `k` as thousands.

**`steps` and ambulatory `exercise` on the same day double-count.** A user who logs `9000 steps` *and* `45 min walk` did one thing, not two. Resolver flags the collision; the engine resolves it (see `06-NUTRITION-ENGINE.md`).

### Water

`1 glass of water` → 250ml. `1 litre` → 1000ml. `2 glasses` → 500ml.
Glass size is a Slate constant (250ml), **not** a kitchen calibration field. Four questions is the limit; a fifth is a form.

---

## Output schema

The model returns JSON. Nothing else. No prose, no markdown fences.

```json
{
  "intent": "food",
  "ref": "dish_rajma",
  "qty": 1,
  "unit": "katori",
  "context": "home",
  "confidence": 0.94
}
```

Parse strictly. On parse failure → `unresolved`. Never regex a number out of prose.

---

## System prompt (shape, not final copy)

```
You classify Indian food journal entries. You never state calories.

Given a line of text, return JSON only:
{intent, ref, qty, unit, context, confidence}

intent: "food" | "exercise" | "weight" | "water" | "steps" | "sleep"
ref:    an id from the provided catalogue. Never invent one.
        null for weight, water, steps, sleep.
unit:   katori | plate | glass | cup | piece | roti | tbsp | tsp |
        g | ml | kg | l | minutes | km | steps | hours
context: "outside" if the text implies a restaurant, hotel, or delivery
         (swiggy, zomato, ordered, outside, hotel, restaurant, canteen).
         otherwise "home".
confidence: 0-1. Below 0.6 means you are guessing. Say so.

Weight: first-person body phrasing ("I weigh", "I'm at", "weigh-in")
        beats everything. A bare mass is weight only with no food noun
        and a value between 30 and 250 kg. "2 kg chicken" is food.
        A bare integer is food.

The user writes Hinglish. "2 roti aur ek katori dal" is two entries,
not one. Split on conjunctions and return an array.

If a line names a food you cannot match to the catalogue, return
confidence 0.0 rather than the nearest neighbour. A wrong match is
worse than no match.
```

The catalogue (dish names + aliases) is injected, not memorised. When we add a dish, the resolver knows about it immediately.

### Multi-entry lines

`2 roti aur ek katori dal` → two entries, two lines, two numbers. Split at the resolver, not in the UI.

---

## The `context` flag

Restaurant food runs 30–40% above the home equivalent — more oil, more cream, larger portions.

`context: "outside"` applies a **+35% fat multiplier** to `cooking_fat_ml` and a **+20% portion multiplier**. Kitchen calibration does **not** apply — it's not your kitchen.

One token from the model. Largest single accuracy win after calibration itself.

---

## Personalization: a modifier, not an authority

`profiles.personalization` is free text written by the user, injected into the resolver's context. `"I always cook with very little oil."`

This is a user-authored instruction flowing into a system that outputs numbers. Bound it.

**It may:**
- adjust `cooking_fat_ml` within ±30%
- adjust final `kcal` within ±20%
- express portion habits ("I use a small katori")

**It may not:**
- override `dish_ingredients` base values
- change macros it has no bearing on
- set confidence
- introduce a `ref` not in the catalogue

Someone who types *"everything I eat is 50 calories"* gets a slightly leaner poha. Not a lie.

Implement as a post-multiplier clamp in the nutrition engine, **not** as a prompt instruction the model can be talked out of.

```ts
const clamped = clamp(base * personalizationFactor, base * 0.8, base * 1.2);
```

---

## Caching

`normalized_text` is the key. Global, not per-user.

Hit rate should exceed 90% within weeks. `2 roti`, `chai`, `1 katori dal`, `2 eggs` — the head of this distribution is extremely short.

**Cache the resolution, not the nutrition.** Nutrition depends on the user's kitchen calibration, which differs per user. Cache `{intent, ref, qty, unit}` and compute nutrition locally every time.

That distinction is the whole architecture. Get it wrong and every user gets Nirmal's oil consumption.

---

## Latency budget

| Step | Budget |
|---|---|
| normalize | < 1ms |
| cache lookup (SQLite) | < 5ms |
| LLM call (cache miss) | < 1200ms p95 |
| compute | < 2ms |

On a cache hit the number should appear before the shimmer completes. That is the feeling we are selling.

---

## Model

Start with a hosted small model — the task is classification against a provided catalogue, not world knowledge. Evaluate on a 500-line Hinglish test set before committing. Keep the interface behind `resolve(text): Promise<Resolution[]>` so the model is swappable in one file.

Build the test set first. 500 real lines, hand-labelled, drawn from how Nirmal, Nehal, and ten friends actually type.
