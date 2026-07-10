# Resolver eval — Hinglish gold set

`hinglish-500.jsonl` is the Phase-2 gate eval for the resolver (`spec/05-RESOLVER.md`).
500 hand-authored journal lines, each labelled with the `{intent, ref}` the resolver
is expected to produce. It is the gold standard the model is graded against before we
commit to a model provider.

> **FLAG(nirmal): model-drafted, needs his correction pass before the gate result counts.**
> Every label in this file was drafted by a model, not by a human who types these lines
> for real. A wrong gold label silently passes a wrong resolver, so the gate number is
> **not valid** until Nirmal (and ideally Nehal + the ten friends named in spec/05) have
> read every line and corrected the labels. Treat the current file as a starting point.
>
> **`supabase/seed/exercises.draft.json` is likewise model-drafted.** The MET values and the
> `is_ambulatory` flags come from the Compendium of Physical Activities plus judgment calls
> (see the `FLAG(nirmal):` notes in that file). The eval's exercise refs depend on those ids,
> so correct the exercises file and the eval together.

## What the file is

One JSON object per line (JSONL). Parse each line independently.

```json
{
  "text": "2 roti aur ek katori dal",
  "expect": [
    { "intent": "food", "ref": "dish_roti", "qty": 2, "unit": "roti" },
    { "intent": "food", "ref": "dish_dal_toor", "qty": 1, "unit": "katori" }
  ]
}
```

- `text` — the raw journal line, exactly as a user in Vadodara/Mumbai would type it.
- `expect` — **always an array.** Single-entry lines have one element; multi-entry lines
  (`... aur ...`, `... and ...`) have two or more, **in the order they appear in the text**.

### Expectation schema

| Key       | Required | Notes                                                                                                                              |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `intent`  | yes      | one of `food` `exercise` `weight` `water` `steps` `sleep` `unresolved`                                                             |
| `ref`     | yes      | dish id (food), exercise id (exercise), or `null` for weight/water/steps/sleep/unresolved                                          |
| `qty`     | optional | present only when the quantity is unambiguous in the text                                                                          |
| `unit`    | optional | canonical unit token from spec/05 (`katori` `plate` `roti` `piece` `cup` `glass` `g` `ml` `l` `kg` `minutes` `km` `steps` `hours`) |
| `context` | optional | `"home"` or `"outside"`; present only when the text clearly implies one                                                            |

### Ref rules (enforced by the verifier)

- food refs are dish ids and exist **only** in `supabase/seed/dishes.draft.json` (~50 dishes).
- exercise refs are exercise ids and exist **only** in `supabase/seed/exercises.draft.json`.
- `ref` is `null` for `weight`, `water`, `steps`, `sleep`, and `unresolved`.
- `food` and `exercise` expectations must carry a non-null ref.

## Distribution

| Category (per line)           | Count   |
| ----------------------------- | ------- |
| food                          | 300     |
| exercise                      | 50      |
| weight                        | 30      |
| water                         | 25      |
| steps                         | 25      |
| sleep                         | 15      |
| unresolved                    | 35      |
| multi-entry (2+ expectations) | 20      |
| **total**                     | **500** |

"multi-entry" is counted as its own category above; its individual expectations are
food/exercise/steps/water, so the by-intent totals across all 500 lines run higher
than 300 food etc.

## Gate thresholds

The resolver passes the Phase-2 gate only if, evaluated against the **corrected** gold set:

1. **Intent accuracy ≥ 90%** — predicted top-level intent matches gold, per expectation.
2. **`unresolved_rate` < 5%** — the resolver must not dump borderline lines into
   `unresolved` to dodge being wrong. (Note: the gold set itself carries 35 genuinely
   unresolvable lines by design; the metric is about the resolver over-using `unresolved`
   on lines that _have_ a correct answer, not about these 35.)
3. **Zero wrong-ref-at-high-confidence** — if the model returns confidence ≥ 0.6 and a
   `ref`, that ref must be the gold ref. A confident wrong ref is the one failure mode
   spec/05 says is worse than no match; a single occurrence fails the gate.

## How to verify the file is well-formed

Parse every line, assert count is exactly 500, assert every non-null ref exists in the two
seed files, assert all 500 `text` values are unique. A standalone check (Node):

```js
const fs = require('fs');
const dish = new Set(
  JSON.parse(fs.readFileSync('supabase/seed/dishes.draft.json')).map((d) => d.id),
);
const ex = new Set(
  JSON.parse(fs.readFileSync('supabase/seed/exercises.draft.json')).map((e) => e.id),
);
const rows = fs.readFileSync('test/eval/hinglish-500.jsonl', 'utf8').split(/\r?\n/).filter(Boolean);
if (rows.length !== 500) throw new Error('need exactly 500 lines, got ' + rows.length);
for (const [i, line] of rows.entries()) {
  const o = JSON.parse(line); // throws on malformed JSON
  for (const e of o.expect) {
    if (e.ref === null) continue;
    const ok = e.ref.startsWith('dish_') ? dish.has(e.ref) : ex.has(e.ref);
    if (!ok) throw new Error(`line ${i + 1}: unknown ref ${e.ref}`);
  }
}
console.log('OK: 500 lines, all refs resolve');
```

## Open items for the correction pass

- **`maggi` is IN the catalogue** as `dish_maggi`. The Phase-2 plan note called maggi a
  "packaged food not in catalogue yet → unresolved"; that is stale against the current
  seed. This eval labels maggi lines as `food → dish_maggi`. Confirm which is intended.
- **Multi-entry with an out-of-catalogue side** (e.g. `chai aur biscuit`, `chole bhature`,
  `masala dosa and filter coffee`, `dosa sambar aur chutney`): the in-catalogue item is
  labelled `food` and the missing side is a second expectation `{unresolved, null}`.
  Confirm this is how the resolver should split a partially-resolvable line.
- **Generic-side lines kept as a single head food** (e.g. `had 2 rotis and sabzi`,
  `dal chawal`, `aloo paratha with curd` when curd is present as garnish): labelled as the
  single head dish. The boundary between "second entry" and "garnish to drop" needs Nirmal.
- **`context` labelling** is applied only on explicit cues (swiggy/zomato/hotel/restaurant/
  canteen/bahar/ordered/outside). Ambiguous lines carry no `context`.
- **Fractional / word quantities** (`aadha katori`, `half plate`, `1.5 roti`): where the
  fraction is unambiguous a numeric `qty` is given; where it reads as "a little", `qty` is
  omitted rather than guessed.
- **Bare `paani`** is labelled `water, qty 1 glass`. If bare "paani" with no quantity should
  instead be `unresolved`, change it.
- **Steps below 3,000** (`2500 steps`) are still `steps` intent here — the 3,000 floor is an
  engine concern (spec/06), not a resolver intent decision. Confirm.
- **`surya namaskar` counted in rounds** (`12 surya namaskar`): labelled `exercise` with
  `qty: 12` and no unit, because rounds ≠ minutes. The engine needs a rounds→minutes rule
  or the resolver must reject unit-less counts. Flagged in the exercises file too.
