# Phase 6 — Harden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden every shipped screen for accessibility extremes, pin the safety guardrails with CI tests, security-review the phase, and produce the honest punch list that closes the Phase 6 gate.

**Architecture:** Pure logic extracted to Node-testable modules (repo pattern: components stay thin, `vitest` covers pure code, RN seams are device-verified). Guardrail tests live in `test/guardrails/` and fail CI on regression. A11y strings compose in a pure module so the exact utterances are pinned by tests.

**Tech Stack:** React Native (Expo), TypeScript strict, Vitest (node env, v8 coverage), no new dependencies.

**Design spec:** `docs/superpowers/specs/2026-07-10-phase-6-harden-design.md`

## Global Constraints

- TypeScript strict, no `any` (escape hatch = `unknown` + narrow).
- Commit format: `area: what changed` (repo convention — NOT `feat:`).
- Canonical units cm/kg/ml/g; tabular figures on every number.
- Copy follows `brand/BRAND-VOICE.md`: sentence case, no em-dashes in UI copy, never "just", errors don't apologise.
- Coverage gates in `vitest.config.ts` must keep passing; new pure modules enter at 100%.
- The one-sentence test: nothing here may make the app slower to open, slower to type into, or louder.
- Two deviations from the design spec, decided during planning (flag in PR):
  1. `adjustsFontSizeToFit` dropped from `numberProps` — per-Text shrink makes numbers in the same column render at different sizes, violating tabular discipline. `numberOfLines: 1` + a scale cap achieves no-wrap.
  2. Macro-goals screen takes gram targets only (no kcal field), so the <1,200 rejection does not apply there. Goal floor is enforced at the calorie-goal surfaces only (onboarding O8 + Settings → Goal), both via `isValidGoal`.

---

### Task 1: Brand-voice guardrail test (banned words, CI-enforced)

**Files:**

- Create: `test/guardrails/brand-voice.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks. Reads source files from disk.
- Produces: a CI-enforced test other tasks must keep green (Tasks 3–5 touch UI copy).

- [ ] **Step 1: Write the test**

```ts
// Brand-voice guardrail (brand/BRAND-VOICE.md "Words we don't", rule 8, rule 10).
// Greps UI copy — string literals and JSX text in the screens and components —
// for banned words. A hit fails CI. This is the "grep for banned brand-voice
// words" gate from the build plan (spec/10 week 8).
//
// Scope: app/**/*.tsx, src/components/**/*.tsx, src/onboarding/draft.ts.
// Code (style objects, identifiers, imports) is excluded by extracting only
// string-literal contents and JSX text nodes, so `transform: [{...}]` in a
// style is not a hit but "transform your body" in copy is.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');

// \b-wrapped, case-insensitive. "earn" does not match "Learn"; "just" does
// not match "adjust" — word boundaries handle both.
const BANNED = [
  'wellness',
  'journey',
  'transform',
  'fuel',
  'nourish',
  'mindful',
  'guilt-free',
  'cheat meal',
  'earn',
  'burn off',
  'smash',
  'crush',
  'healthy',
  'just',
  "we've got you",
  "let's do this",
  'powered by AI',
] as const;

// Rule 8: em-dashes are for essays; UI copy gets full stops.
const EM_DASH = '—';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function copyFiles(): string[] {
  const files = [
    ...walk(path.join(ROOT, 'app')).filter((f) => f.endsWith('.tsx')),
    ...walk(path.join(ROOT, 'src', 'components')).filter((f) => f.endsWith('.tsx')),
    path.join(ROOT, 'src', 'onboarding', 'draft.ts'),
  ];
  return files.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** String-literal contents plus JSX text nodes — the surfaces users read. */
function extractCopy(src: string): string[] {
  const stripped = stripComments(src);
  const out: string[] = [];
  const literal = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const m of stripped.matchAll(literal)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  const jsxText = />([^<>{}]+)</g;
  for (const m of stripped.matchAll(jsxText)) {
    const text = (m[1] ?? '').trim();
    if (text.length > 0) out.push(text);
  }
  return out;
}

describe('brand voice (brand/BRAND-VOICE.md)', () => {
  const files = copyFiles();

  it('scans a sane number of copy files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(BANNED)('UI copy never contains "%s"', (word) => {
    const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const hits: string[] = [];
    for (const file of files) {
      for (const copy of extractCopy(readFileSync(file, 'utf8'))) {
        if (pattern.test(copy)) {
          hits.push(`${path.relative(ROOT, file)}: "${copy}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('UI copy contains no em-dashes (rule 8)', () => {
    const hits: string[] = [];
    for (const file of files) {
      for (const copy of extractCopy(readFileSync(file, 'utf8'))) {
        if (copy.includes(EM_DASH)) {
          hits.push(`${path.relative(ROOT, file)}: "${copy}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect real red or green, and prove it can fail**

Run: `npx vitest run test/guardrails/brand-voice.test.ts`

Two possibilities:

- If it fails: those are real brand-voice violations in shipped copy. Fix the copy (reword per BRAND-VOICE.md), or — only if a hit is genuinely not user-facing copy (e.g. an analytics key string) — add a narrowly-scoped allowlist entry with a comment explaining why. Re-run until green.
- If it passes immediately: prove the test can fail. Temporarily add `<Text>stay healthy</Text>` to `src/components/PlusBadge.tsx`, run again, confirm FAIL with the file named in the diff, then revert the plant and confirm PASS.

- [ ] **Step 3: Commit**

```bash
git add test/guardrails/brand-voice.test.ts
git commit -m "test: brand-voice guardrail — banned words + em-dash grep over UI copy"
```

(If Step 2 fixed real copy violations, include those files with a note in the commit body.)

---

### Task 2: Floor guardrails + closed palette + over-goal copy fix

**Files:**

- Create: `test/guardrails/floors.test.ts`
- Modify: `src/components/SummaryCard.tsx` (over-goal copy, `cals over`)
- Modify: `app/settings/goal.tsx:94-98` (import the rejection constant instead of duplicating copy)

**Interfaces:**

- Consumes: `displayNet(consumedKcal, burnedKcal): number`, `isValidGoal(goal): boolean`, `NET_FLOOR_KCAL` from `@/engine`; `GOAL_REJECTION_MESSAGE`, `validateGoal` from `@/onboarding`; `composeDay(rows)` from `@/journal`; `light`, `dark`, `macros`, `accent` from `@/theme/colors`.
- Produces: nothing consumed later; CI guardrails.

- [ ] **Step 1: Write the failing test**

```ts
// Safety guardrails pinned as tests (plan Phase 6: floor, goal floor,
// no-celebration). Non-negotiable #4: store true, display max(net, 1200),
// never celebrate a low net.

import { describe, expect, it } from 'vitest';

import { displayNet, isValidGoal, NET_FLOOR_KCAL } from '@/engine';
import { composeDay } from '@/journal';
import { GOAL_REJECTION_MESSAGE, validateGoal } from '@/onboarding';
import { accent, dark, light, macros } from '@/theme/colors';

describe('net floor (non-negotiable #4)', () => {
  it('displayNet never returns below 1,200 anywhere in the input space', () => {
    for (let consumed = 0; consumed <= 4000; consumed += 250) {
      for (let burned = 0; burned <= 3000; burned += 250) {
        expect(displayNet(consumed, burned)).toBeGreaterThanOrEqual(NET_FLOOR_KCAL);
      }
    }
  });

  it('an empty day composes to the floored net, not zero', () => {
    const { totals } = composeDay([]);
    expect(totals.flooredNetKcal).toBe(NET_FLOOR_KCAL);
  });
});

describe('goal floor', () => {
  it('rejects below 1,200 and accepts at it', () => {
    expect(isValidGoal(1199)).toBe(false);
    expect(isValidGoal(1200)).toBe(true);
  });

  it('rejection copy is the exact spec sentence', () => {
    expect(GOAL_REJECTION_MESSAGE).toBe("Slate can't set a goal below 1,200 calories.");
    expect(validateGoal('1199')).toEqual({ goal: null, error: GOAL_REJECTION_MESSAGE });
  });
});

describe('no celebration (brand voice rule 2)', () => {
  // The palette is closed: exactly the spec/03 tokens, no success green, no
  // celebratory colour a low or under-goal net could ever be keyed to.
  it('palettes carry exactly the six spec tokens', () => {
    const keys = ['bg', 'fill', 'hairline', 'ink', 'inkMute', 'surface'];
    expect(Object.keys(light).sort()).toEqual(keys);
    expect(Object.keys(dark).sort()).toEqual(keys);
  });

  it('macro colours are the only semantic colours, and accent is the spec indigo', () => {
    expect(Object.keys(macros).sort()).toEqual(['carbs', 'fat', 'protein']);
    expect(accent).toBe('#3E5C9E');
  });
});
```

- [ ] **Step 2: Run — verify current state**

Run: `npx vitest run test/guardrails/floors.test.ts`
Expected: PASS (these behaviors shipped in earlier phases; the test pins them). If any assertion fails, that is a live guardrail regression — stop and fix the source, not the test.

- [ ] **Step 3: Fix the over-goal copy in SummaryCard**

`brand/BRAND-VOICE.md` worked example requires `210 cals over`, but `src/components/SummaryCard.tsx:83` renders `n(left)` even when `left` is negative, producing `-210 cals left`. Replace the caption line:

```tsx
<Text style={[type.caption, { color: colors.inkMute }]}>
  {left !== null ? (left >= 0 ? `${n(left)} cals left` : `${n(-left)} cals over`) : 'No goal set'}
  {totals.pendingCount > 0 ? `  ·  +${totals.pendingCount} pending` : ''}
</Text>
```

Same colour, same size, no styling change — over-goal renders exactly like any other day (rule 2).

- [ ] **Step 4: Deduplicate the goal rejection copy**

In `app/settings/goal.tsx`, add to the imports:

```ts
import { GOAL_REJECTION_MESSAGE } from '@/onboarding';
```

and replace lines 94–98:

```tsx
{
  rejected && (
    <Text style={[type.label, styles.note, { color: colors.ink }]}>{GOAL_REJECTION_MESSAGE}</Text>
  );
}
```

One sentence, one source (`src/onboarding/draft.ts:87`), pinned by the guardrail test.

- [ ] **Step 5: Verify everything holds**

Run: `npx tsc --noEmit && npx vitest run test/guardrails/`
Expected: clean compile, both guardrail files PASS.

- [ ] **Step 6: Commit**

```bash
git add test/guardrails/floors.test.ts src/components/SummaryCard.tsx app/settings/goal.tsx
git commit -m "test: floor + palette guardrails; fix over-goal copy to 'cals over'"
```

---

### Task 3: Dynamic Type — numbers never wrap

**Files:**

- Modify: `src/theme/typography.ts` (add `numberProps`, `numberMaxFontScale`)
- Modify: `src/theme/index.ts` (export them)
- Modify: every `Text` styled with `type.number` / `type.heroNumber` (site list below)
- Modify: every `TextInput` styled with them (site list below)

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: `numberProps: { numberOfLines: 1; maxFontSizeMultiplier: number }` and `numberMaxFontScale: number`, exported from `@/theme`. Task 4's edits to `JournalLine`/`SummaryCard` assume these props are already applied there.

- [ ] **Step 1: Add the tokens to `src/theme/typography.ts`** (append after the `type` export)

```ts
// spec/03 Accessibility: Dynamic Type up to xxLarge. Text reflows; a number
// never wraps. Numbers cap their font scaling at the xxLarge step (iOS
// fontScale ≈ 1.35 there) while body copy keeps scaling with the system
// setting. numberOfLines: 1 is the hard guarantee; the cap keeps the digits
// fitting rather than ellipsizing.
export const numberMaxFontScale = 1.35;

export const numberProps = {
  numberOfLines: 1,
  maxFontSizeMultiplier: numberMaxFontScale,
} as const;
```

- [ ] **Step 2: Export from `src/theme/index.ts`**

Change the typography export line to:

```ts
export { fontFamily, numberMaxFontScale, numberProps, tabular, type } from './typography';
```

- [ ] **Step 3: Apply mechanically at every number site**

Rule: every `<Text>` whose style includes `type.number` or `type.heroNumber` gets `{...numberProps}` as its first props; every `<TextInput>` styled with them gets `maxFontSizeMultiplier={numberMaxFontScale}`. Import from `@/theme` in each file (extend the existing `@/theme` import).

Text sites:

- `app/index.tsx:214, 281`
- `app/onboarding.tsx:257, 409, 415, 465, 477`
- `app/settings/body.tsx:253, 259`
- `app/settings/goal.tsx:104, 110`
- `app/stats.tsx:118, 137, 178, 212, 218`
- `app/streak.tsx:41, 48`
- `src/components/DetailSheet.tsx:88, 119`
- `src/components/JournalLine.tsx:85, 91, 97, 103, 108, 112`
- `src/components/ListRow.tsx:34`
- `src/components/RangeCalendar.tsx:110`
- `src/components/SummaryCard.tsx:78, 116`

TextInput sites (`maxFontSizeMultiplier={numberMaxFontScale}` only — `numberOfLines` is not a meaningful iOS TextInput prop):

- `app/onboarding.tsx:535` (goal field)
- `app/settings/body.tsx:141, 173, 187, 199, 234`
- `app/settings/goal.tsx:89`
- `app/settings/kitchen.tsx:123, 135`
- `app/settings/macro-goals.tsx:69`

Example (JournalLine kcal case):

```tsx
<Text {...numberProps} style={[type.number, { color: colors.ink }]}>
  {formatKcal(display.value)}
</Text>
```

Line numbers are pre-edit references — re-locate by the `type.number`/`type.heroNumber` style if edits shift them. After editing, verify completeness:

Run: `git grep -n "type\.number\|type\.heroNumber" -- 'src/**' 'app/**' | grep -v test | grep -v typography`
Every hit line must be inside an element that now carries `numberProps` / `maxFontSizeMultiplier` (open each file at the hit to confirm — the props may sit on the line above the style).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: all clean. (No behavior change under Node tests — these props are RN-render-only.)

- [ ] **Step 5: Commit**

```bash
git add src/theme/typography.ts src/theme/index.ts app/ src/components/
git commit -m "theme: numberProps caps Dynamic Type scaling on numbers — no wrap at xxLarge"
```

---

### Task 4: A11y pure module — pinned VoiceOver utterances

**Files:**

- Create: `src/components/a11y.ts`
- Create: `src/components/a11y.test.ts`
- Modify: `src/components/JournalLine.tsx` (import from a11y, delete local copies)
- Modify: `src/components/SummaryCard.tsx` (composed single-utterance label)
- Modify: `vitest.config.ts` (coverage include + 100% threshold for the new module)

**Interfaces:**

- Consumes: `LineDisplay` type from `@/journal`; Task 3's `numberProps` already applied in these components.
- Produces:
  - `formatKcal(value: number): string` — en-IN grouped integer string.
  - `journalLineLabel(rawText: string, display: LineDisplay, hideCalories: boolean): string`
  - `summaryLabel(totals: { flooredNetKcal: number; pendingCount: number }, calorieGoal: number | null, hideCalories: boolean): string`

- [ ] **Step 1: Write the failing test**

```ts
// The exact VoiceOver utterances (spec/03: a journal line reads as one
// utterance, "2 rotis, 220 calories" — never two). Pinned here so a copy
// change is a deliberate diff, not an accident.

import { describe, expect, it } from 'vitest';

import { formatKcal, journalLineLabel, summaryLabel } from './a11y';

describe('formatKcal', () => {
  it('rounds and groups en-IN', () => {
    expect(formatKcal(2610.4)).toBe('2,610');
    expect(formatKcal(220)).toBe('220');
  });
});

describe('journalLineLabel — one utterance per line', () => {
  it('food line', () => {
    expect(journalLineLabel('2 rotis', { kind: 'kcal', value: 220 }, false)).toBe(
      '2 rotis, 220 calories',
    );
  });
  it('exercise line', () => {
    expect(journalLineLabel('30 min walk', { kind: 'burn', value: -120 }, false)).toBe(
      '30 min walk, minus 120 calories',
    );
  });
  it('hide-calories mode keeps the text, drops the number', () => {
    expect(journalLineLabel('2 rotis', { kind: 'kcal', value: 220 }, true)).toBe('2 rotis');
    expect(journalLineLabel('30 min walk', { kind: 'burn', value: -120 }, true)).toBe(
      '30 min walk',
    );
  });
  it('included, pending, retry, check', () => {
    expect(journalLineLabel('6k steps', { kind: 'included' }, false)).toBe('6k steps, included');
    expect(journalLineLabel('chai', { kind: 'pending' }, false)).toBe('chai, resolving');
    expect(journalLineLabel('xyzzy', { kind: 'retry' }, false)).toBe(
      'xyzzy, unresolved, tap to retry',
    );
    expect(journalLineLabel('72 kg', { kind: 'check' }, false)).toBe('72 kg, logged');
  });
});

describe('summaryLabel — the card is one utterance', () => {
  it('under goal', () => {
    expect(summaryLabel({ flooredNetKcal: 1790, pendingCount: 0 }, 2400, false)).toBe(
      '610 calories left, 1,790 of 2,400. Tap to view options',
    );
  });
  it('over goal says over, never minus-left', () => {
    expect(summaryLabel({ flooredNetKcal: 2610, pendingCount: 0 }, 2400, false)).toBe(
      '210 calories over, 2,610 of 2,400. Tap to view options',
    );
  });
  it('no goal', () => {
    expect(summaryLabel({ flooredNetKcal: 1790, pendingCount: 0 }, null, false)).toBe(
      '1,790 calories, no goal set. Tap to view options',
    );
  });
  it('pending entries are counted in the utterance', () => {
    expect(summaryLabel({ flooredNetKcal: 1790, pendingCount: 2 }, 2400, false)).toBe(
      '610 calories left, 1,790 of 2,400, 2 pending. Tap to view options',
    );
  });
  it('hide-calories mode states nothing numeric', () => {
    expect(summaryLabel({ flooredNetKcal: 1790, pendingCount: 0 }, 2400, true)).toBe(
      'Day summary. Tap to view options',
    );
    expect(summaryLabel({ flooredNetKcal: 1790, pendingCount: 1 }, 2400, true)).toBe(
      'Day summary, 1 pending. Tap to view options',
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/a11y.test.ts`
Expected: FAIL — `Cannot find module './a11y'`.

- [ ] **Step 3: Write `src/components/a11y.ts`**

```ts
// VoiceOver copy, composed as pure functions so the exact utterances are
// pinned by Node tests (spec/03 Accessibility: a journal line is ONE
// utterance; the summary card likewise). Numbers say "calories" long-form —
// VoiceOver reads prose, not UI shorthand (brand voice: cals in UI, calories
// in prose).

import type { LineDisplay } from '@/journal';

export function formatKcal(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}

export function journalLineLabel(
  rawText: string,
  display: LineDisplay,
  hideCalories: boolean,
): string {
  switch (display.kind) {
    case 'kcal':
      return hideCalories ? rawText : `${rawText}, ${formatKcal(display.value)} calories`;
    case 'burn':
      return hideCalories ? rawText : `${rawText}, minus ${formatKcal(-display.value)} calories`;
    case 'included':
      return `${rawText}, included`;
    case 'pending':
      return `${rawText}, resolving`;
    case 'retry':
      return `${rawText}, unresolved, tap to retry`;
    default:
      return `${rawText}, logged`;
  }
}

export function summaryLabel(
  totals: { flooredNetKcal: number; pendingCount: number },
  calorieGoal: number | null,
  hideCalories: boolean,
): string {
  const pending = totals.pendingCount > 0 ? `, ${totals.pendingCount} pending` : '';
  if (hideCalories) return `Day summary${pending}. Tap to view options`;
  const net = totals.flooredNetKcal;
  if (calorieGoal === null) {
    return `${formatKcal(net)} calories, no goal set${pending}. Tap to view options`;
  }
  const left = calorieGoal - net;
  const position =
    left >= 0 ? `${formatKcal(left)} calories left` : `${formatKcal(-left)} calories over`;
  return `${position}, ${formatKcal(net)} of ${formatKcal(calorieGoal)}${pending}. Tap to view options`;
}
```

Note: if `LineDisplay`'s exact variant fields differ from the test literals (check `src/journal/compose.ts:39`), match the source type — the test literals must be valid `LineDisplay` values.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/a11y.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Wire `JournalLine.tsx`**

Delete the local `formatKcal` (lines 16–18) and `accessibilityFor` (lines 20–36). Add import:

```ts
import { formatKcal, journalLineLabel } from './a11y';
```

Change the Pressable's label (line 122):

```tsx
      accessibilityLabel={journalLineLabel(entry.raw_text, line.display, hideCalories)}
```

(`line.display` and `entry` are already destructured in the component.)

- [ ] **Step 6: Wire `SummaryCard.tsx`**

Delete the local `n()` (lines 53–55); import and alias to keep the JSX diff minimal:

```ts
import { formatKcal as n, summaryLabel } from './a11y';
```

Replace the static label (line 93):

```tsx
      accessibilityLabel={summaryLabel(totals, calorieGoal, hideCalories)}
```

The visual caption keeps the Task 2 `cals left`/`cals over` form (UI says cals; VoiceOver says calories).

- [ ] **Step 7: Add coverage gate**

In `vitest.config.ts`: add `'src/components/a11y.ts'` to `coverage.include`, and to `thresholds`:

```ts
        'src/components/a11y.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
```

- [ ] **Step 8: Full verify**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run --coverage`
Expected: clean; a11y.ts at 100%; all prior gates hold.

- [ ] **Step 9: Commit**

```bash
git add src/components/a11y.ts src/components/a11y.test.ts src/components/JournalLine.tsx src/components/SummaryCard.tsx vitest.config.ts
git commit -m "components: pure a11y module — pinned single-utterance VoiceOver labels"
```

---

### Task 5: Surgical a11y fixes (roles, labels, state)

**Files:**

- Modify: `app/index.tsx` (~line 211), `src/components/RangeCalendar.tsx` (~line 98), `src/components/Drawer.tsx` (~line 58), `src/components/Sheet.tsx` (~line 20), `src/components/DetailSheet.tsx` (~line 80), `src/components/Segmented.tsx` (~line 21)

**Interfaces:**

- Consumes: nothing from other tasks (line numbers may have shifted by ±2 from Task 3's prop additions — locate by the code shown).
- Produces: nothing consumed later.

Audit context: all other Pressables flagged in the phase audit have meaningful `Text` children, which RN merges into the announced label — they are correct as-is. These six sites are the genuine gaps.

- [ ] **Step 1: `app/index.tsx` — day header Pressable has no role**

Locate `<Pressable onPress={() => setScrubbing((s) => !s)} style={styles.header}>`. Add:

```tsx
          <Pressable
            onPress={() => setScrubbing((s) => !s)}
            accessibilityRole="button"
            style={styles.header}
          >
```

(Children — the title and running total — merge into the announcement; no explicit label needed.)

- [ ] **Step 2: `src/components/RangeCalendar.tsx` — date cell announces a bare number**

The cell Pressable renders just the day-of-month digit. Add a full-date label and selection state (inside the `cell.key === null ? ... :` else branch, where `cell.key` is an ISO `YYYY-MM-DD` string):

```tsx
            <Pressable
              key={cell.key}
              accessibilityRole="button"
              accessibilityLabel={cell.key}
              accessibilityState={{ selected: cell.key === start || cell.key === end }}
              onPress={() => tap(cell.key as string)}
```

(ISO date as label is deliberate: unambiguous, no locale formatting in Phase 6 scope.)

- [ ] **Step 3: `src/components/Drawer.tsx` — scrim has a label but no role**

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel="Close menu"
  onPress={onClose}
  style={[StyleSheet.absoluteFill, styles.scrim]}
/>
```

- [ ] **Step 4: `src/components/Sheet.tsx` — backdrop has a label but no role**

Locate the backdrop Pressable (~line 20) and add `accessibilityRole="button"` alongside its existing label.

- [ ] **Step 5: `src/components/DetailSheet.tsx` — retry ends in a bare ↻ glyph**

VoiceOver reads `↻` as a Unicode name. Override with an explicit label (the visible text keeps the glyph):

```tsx
      {display.kind === 'retry' && (
        <Pressable
          onPress={() => onRetry(entry.id)}
          accessibilityRole="button"
          accessibilityLabel="Not sure what this is. Try adding detail? Retry"
        >
```

- [ ] **Step 6: `src/components/Segmented.tsx` — verify selected state**

Open the option Pressable (~line 21). If it does not already carry `accessibilityState={{ selected }}` (with the option's active boolean), add it. Text children announce the option name; state announces selection.

- [ ] **Step 7: Verify + commit**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: clean.

```bash
git add app/index.tsx src/components/
git commit -m "a11y: roles on header/scrim/backdrop, calendar date labels, retry label, segment state"
```

---

### Task 6: Extract `useReducedMotion` to its own module

**Files:**

- Create: `src/components/useReducedMotion.ts`
- Modify: `src/components/Shimmer.tsx` (remove hook + its exports/imports, import the new module)
- Modify: `src/components/JournalLine.tsx:14` (import path)

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: `useReducedMotion(): boolean` from `src/components/useReducedMotion.ts` — any future Animated call site imports this, not Shimmer.

Audit context: Shimmer and JournalLine's `SettledNumber` are the only two Animated call sites in the codebase (verified by grep this phase); both honor reduced motion. This task is placement only, so the hook stops living inside one consumer.

- [ ] **Step 1: Create `src/components/useReducedMotion.ts`** (moved verbatim from `Shimmer.tsx:17-31`)

```ts
// prefers-reduced-motion (spec/03 Accessibility): the shimmer and the number
// settle are the only two animations, and both fall back to static when the
// system setting asks for it. Any future Animated call site imports this.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
```

- [ ] **Step 2: Update `Shimmer.tsx`**

Delete the hook (lines 17–31), remove `AccessibilityInfo`, `useState`-only-for-hook imports it no longer needs (keep `useState` — the sweep value still uses it), and add:

```ts
import { useReducedMotion } from './useReducedMotion';
```

- [ ] **Step 3: Update `JournalLine.tsx:14`**

```ts
import { Shimmer } from './Shimmer';
import { useReducedMotion } from './useReducedMotion';
```

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: clean. (The hook is RN-native — device-verified like `src/db/expo.ts`; it stays outside Node coverage.)

```bash
git add src/components/useReducedMotion.ts src/components/Shimmer.tsx src/components/JournalLine.tsx
git commit -m "components: useReducedMotion into its own module"
```

---

### Task 7: Draft docs — handoff, breach playbook, listing, privacy policy

**Files:**

- Create: `docs/analytics-handoff.md`
- Create: `docs/breach-playbook.md`
- Create: `docs/app-store-listing.md`
- Create: `docs/privacy-policy-draft.md`

**Interfaces:** none — standalone documents. All four are DRAFTS for founders/counsel; each opens with a status line saying so.

- [ ] **Step 1: `docs/analytics-handoff.md`** — the PostHog constraints for the developer who implements analytics. Must contain, each as its own section with the spec citation:
  - Status line: `DRAFT — handoff to the analytics developer. Decisions here were made 10 Jul 2026 with the founder; do not relax them without re-opening the DPDP review.`
  - **Host:** self-hosted PostHog in `ap-south-1` (Mumbai). Never PostHog US/EU Cloud — founder decision, keeps data in India (spec/08 data-residency posture). SDK host must be pinned via `EXPO_PUBLIC_POSTHOG_HOST`; the build must fail loudly if the key is present but the host is missing.
  - **No autocapture, no session recording.** The journal is a free-text health surface; autocapture would exfiltrate `raw_text`. Explicit capture calls only.
  - **`raw_text` never leaves** (spec/08: "Analytics never sees raw_text. Resolved `ref` only"; non-negotiable #9). Enforce by construction: a single `src/lib/analytics.ts` boundary exposing a typed event union — no free-form `capture(name, props)` export. No event payload field may carry entry text, normalized text, or nicknames.
  - **Identity:** `identify(auth.uid())` only; no PII traits. Same id RevenueCat is aliased to.
  - **Gating:** SDK inert when `EXPO_PUBLIC_POSTHOG_KEY` is absent (mirror `src/lib/revenuecat.ts` require-guard pattern).
  - **Suggested event set** (from the week-8 dashboard needs, spec/10: `unresolved_rate` and resolver p95): `entry_resolved {intent, ref, confidence_bucket, resolve_ms}`, `entry_unresolved {normalized_len}`, `screen_viewed {screen}`, `paywall_viewed {gate}`, `purchase_completed {plan}`, `export_run`, `delete_run`.
  - **Before go-live:** processor named in the O0 privacy notice; DPDP processor terms reviewed by counsel; wizard-generated code (if any PR exists from the PostHog wizard) must be discarded, not merged.

- [ ] **Step 2: `docs/breach-playbook.md`** — per spec/08 §6 (72 hours, Board + affected users). Must contain:
  - Status line: `DRAFT — founders + counsel finalize before launch. Names in brackets are placeholders the founders fill.`
  - **Who declares:** a named decision-owner `[founder: Nirmal or Nehal]` and their deputy; the clock starts at declaration.
  - **Clock:** 72 hours to notify the Data Protection Board and affected users (DPDP). Timeline table: T+0 declare and freeze affected systems, T+12h scope assessment (which tables, which users, RLS audit), T+24h draft notifications, T+48h Board notification sent, T+72h user notification live.
  - **How we reach users without email addresses:** in-app banner (ships behind a remote flag), App Store update note, website notice. Exact banner copy drafted in the playbook, in Slate's voice (flat, factual, actionable — errors don't apologise).
  - **What the notification says:** what data, what window, what we did, what the user can do (export, delete), grievance officer contact.
  - **Post-incident:** root-cause doc within 14 days; retention-log purge check; RLS cross-user test re-run recorded.
- [ ] **Step 3: `docs/app-store-listing.md`** — per spec/10 line 130 and spec/08's closing promise. Must contain:
  - Status line: `DRAFT — founders finalize wording; marketing register stays inside brand/BRAND-VOICE.md.`
  - Title/subtitle options leading with **No login. No coaches. No sales calls.**
  - Description built on the spec/08 promise: `No login. No ads. No data sold. Your entries stay in India, and you can export or delete all of them from Settings.`
  - What-Slate-is paragraph (a notes app that knows about food; type a line, a number appears), what Plus adds (photo logging, chat, Apple Health, custom dishes, full history — stated flat, no urgency), and the 18+ age rating note (spec/08 children section).
  - Keyword list (calorie journal, Indian food, roti, dal, IFCT — no "wellness", no "transform": the banned-words list applies to the listing too).
- [ ] **Step 4: `docs/privacy-policy-draft.md`** — skeleton mirroring spec/08 §1's itemized O0 notice, expanded to policy length. Must contain:
  - Status line: `DRAFT — counsel reviews before publishing; the grievance officer name is a founder decision and is a placeholder here.`
  - Sections: what we collect (age, sex, height, weight, food entries, calorie goal); why (compute calories, show trends — nothing else); where (Supabase `ap-south-1`, Mumbai, India); processors (the resolver's model provider — zero-retention, no-training, named; transfer disclosed if hosted outside India; analytics processor `[pending — see analytics-handoff]`); who sees it (nobody; no sale, no ads); your rights (access, correct, export, delete — all from Settings, mapped to DPDP sections); retention (24-month inactive deletion with notice, 1-year processing logs, `resolution_cache` holds no personal data); children (18+, no collection under 18); grievance officer `[name — founder decision]` and `support@slate.app`; breach notification commitment (72h).

- [ ] **Step 5: Voice check + commit**

Re-read all four against `brand/BRAND-VOICE.md` (the banned-words test does not scan `docs/`, so check by hand — especially the listing).

```bash
git add docs/analytics-handoff.md docs/breach-playbook.md docs/app-store-listing.md docs/privacy-policy-draft.md
git commit -m "docs: phase-6 drafts — analytics handoff, breach playbook, listing, privacy policy"
```

---

### Task 8: Security self-review (Opus subagent)

**Files:** none created directly; findings may modify code. Report lands in the punch list (Task 9) and the PR body.

**Interfaces:**

- Consumes: the completed Tasks 1–7 diff.
- Produces: a findings list with severities; any fix commits.

- [ ] **Step 1: Dispatch an Opus subagent** (per the standing model split: reviews run on Opus) with this brief:

> Review branch `phase-6-harden` (diff vs `phase-5-rest-of-app`) plus the standing posture, in repo `c:\Slate`. Frame: what could an attacker do with what this phase ships, and what stops them? Check specifically:
>
> 1. The guardrail test files read source from disk — confirm they cannot be induced to read outside the repo and contain no shell/exec.
> 2. A11y labels: confirm no label leaks another user's data or anything beyond what the screen already shows (labels are composed from on-screen values only).
> 3. The four draft docs: confirm no secrets, keys, project refs, or internal URLs; confirm the breach playbook does not overpromise timelines DPDP does not require.
> 4. Standing posture re-check on the touched files: no service-role key in client code, no `raw_text` egress paths added, `resolution_cache` still has no user scoping in client mirrors, secrets still git-ignored.
> 5. `npm audit` — report new highs/criticals only.
>    Return: findings ranked by severity with file:line, each with a concrete attack scenario or "clean".

- [ ] **Step 2: Fix anything at severity medium or above** — one commit per concern, `area: what changed` format. Log low/informational findings for the punch list instead of fixing, unless trivial.

- [ ] **Step 3: Record** the review summary (finding count by severity, fixes applied) for Task 9's punch list and the eventual PR body.

---

### Task 9: Punch list + gate verify

**Files:**

- Create: `docs/phase-6-punch-list.md`

**Interfaces:**

- Consumes: outcomes of every prior task, including Task 8's review summary.
- Produces: the Phase 6 gate deliverable.

- [ ] **Step 1: Full gate run**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run --coverage`
Expected: zero errors, all tests pass, every coverage threshold holds (including the new `a11y.ts` at 100%). Paste the summary counts into the punch list. If anything fails, fix it before writing the list — the list records verified reality.

- [ ] **Step 2: Write `docs/phase-6-punch-list.md`** — three sections, every row honest:

**Verified in code this phase** (each with how):

- Banned brand-voice words + em-dash: CI test over UI copy (`test/guardrails/brand-voice.test.ts`)
- Net floor 1,200 + goal floor + exact rejection copy: CI test (`test/guardrails/floors.test.ts`)
- No-celebration: closed palette pinned by test; over-goal copy fixed to `cals over` (same grey, same size)
- Dynamic Type: numbers capped + `numberOfLines: 1` at every `type.number`/`heroNumber` site
- VoiceOver: single-utterance labels pinned by test (journal line, summary card); roles/labels/state fixed at the six audited gaps
- Reduced motion: both Animated call sites (shimmer, settle) honor it; hook extracted; grep confirms no other animation

**Owed to the real-device half (Nirmal):**

- xxLarge Dynamic Type walkthrough on device (journal, stats, settings, onboarding)
- VoiceOver pass on device: journal line one-utterance confirmed by ear; drawer, sheets, scanner
- Reduced-motion setting flipped on device: shimmer static, settle instant
- Airplane-mode re-pass across every flow (spec/10 wk8 line 122) — automated journal test exists; onboarding/scanner/export flows need the device
- On-device halves still open from Phases 3–5 (recordings; purchase/restore; scanner camera; export share sheet; delete flow)

**Blocked on founders / counsel / external:**

- PostHog analytics: whole workstream with the developer (`docs/analytics-handoff.md`); `unresolved_rate` + resolver p95 dashboard depends on it
- Privacy policy publish + grievance officer name (`docs/privacy-policy-draft.md`)
- Breach playbook finalization (`docs/breach-playbook.md`)
- App Store listing finalization (`docs/app-store-listing.md`)
- TestFlight: Apple org, EAS build, 30 testers
- SQLite/AsyncStorage at-rest encryption decision (carried from Phase 5, DPDP, with counsel)
- Resolver: provider key → live eval → Edge Function deploys (`resolver-classify`, `delete-account`) — carried from Phases 2/5
- PR mechanics: PR #1 (phase 5) open; this branch targets `phase-5-rest-of-app` until #1 merges, then rebases to `main`

- [ ] **Step 3: Commit**

```bash
git add docs/phase-6-punch-list.md
git commit -m "docs: phase-6 punch list — the honest gate"
```

- [ ] **Step 4: Stop.** Push the branch, report the punch list to the founder, and wait for the go. Do not open the Phase 6 PR, merge, or start TestFlight work without it.

---

## Self-review notes

- Spec coverage: design workstreams 1–5 map to Tasks 3 / 4–5 / 6 / 1–2 / 7–9 respectively; the two deviations (adjustsFontSizeToFit, macro-goals floor) are declared in Global Constraints and both trace to verified source reads.
- Type consistency: `journalLineLabel(rawText, display, hideCalories)` and `summaryLabel(totals, calorieGoal, hideCalories)` are defined in Task 4 and used nowhere else; `numberProps`/`numberMaxFontScale` defined in Task 3 and assumed by Task 4's JSX (which re-shows the props inline).
- Line numbers are pre-edit references throughout; every step also locates by code content.
