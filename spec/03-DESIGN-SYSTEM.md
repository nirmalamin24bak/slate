# 03 — Design System

Minimal directions need precision. There is nowhere to hide on a white screen.

---

## Typeface

**Inter Tight.** One family, all weights. Variable. Free (OFL).

A tight grotesque with the same posture as the reference: heavy display weight, negative tracking at large sizes, high x-height, geometric numerals. It reads identical at a glance and is not the same face — which matters, because identical typography plus identical layout in the same category is what trade dress means.

**Tabular figures everywhere a number appears.** Non-negotiable. Calories change as the resolver returns; digits must not jitter.

```ts
// React Native
fontVariant: ['tabular-nums']
```

### Type scale

| Role | Size | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 40 | 800 | -0.03em | Onboarding headlines |
| `title` | 28 | 700 | -0.02em | Screen titles (`Stats`, `Today`) |
| `hero-number` | 44 | 700 | -0.02em | `85.0 kg`, `0 cals` in Stats |
| `body` | 17 | 500 | -0.01em | Journal lines, list rows |
| `number` | 17 | 500 | 0 | Calorie values (tabular) |
| `label` | 15 | 500 | 0 | `protein`, `carbs`, `fat` |
| `caption` | 13 | 500 | 0 | Grey subtext, `Research sources` |

Sentence case throughout. No all-caps. No italics.

---

## Colour

Slate: a grey-blue stone you write on and wipe clean. The palette is graphite and chalk, with warmth held back for the numbers that matter.

### Light

| Token | Hex | Use |
|---|---|---|
| `bg` | `#F7F7F5` | App background |
| `surface` | `#FFFFFF` | Cards, sheets |
| `fill` | `#EFEFEC` | Chips, input wells, inactive segments |
| `ink` | `#111214` | Primary text, primary buttons |
| `ink-mute` | `#8A8B90` | Secondary text, resolved-negative numbers |
| `hairline` | `#E3E3DF` | Dividers |

### Dark

| Token | Hex |
|---|---|
| `bg` | `#0E0F11` |
| `surface` | `#191A1D` |
| `fill` | `#232428` |
| `ink` | `#F5F5F3` |
| `ink-mute` | `#7E7F85` |
| `hairline` | `#2B2C30` |

### Macro colours

Semantic, used only in macro contexts. Never decorative.

| Macro | Light | Dark |
|---|---|---|
| Protein | `#C4553D` clay | `#E0765C` |
| Carbs | `#3E5C9E` indigo | `#6B8BD1` |
| Fat | `#B8871F` amber | `#D9A83C` |

### Accent

`#3E5C9E` indigo. Used for: the resolve shimmer, the Plus badge, focus rings. **Nothing else.** Slate has no brand colour splashed across surfaces; the brand is the restraint.

### Resolve shimmer

A horizontal gradient sweep beneath a resolving line, ~900ms, `ease-out`, respects `prefers-reduced-motion` (fall back to a static 30%-opacity fill).

```
transparent → #7FBFA8 (12%) → #3E5C9E (18%) → transparent
```

Barely there. It should read as the line breathing, not as a loading bar.

---

## Spacing

Base unit **4**. Screen padding **24**. Vertical rhythm between journal lines **20**.

| Token | px |
|---|---|
| `xs` | 4 |
| `sm` | 8 |
| `md` | 16 |
| `lg` | 24 |
| `xl` | 32 |
| `2xl` | 48 |

## Radius

| Token | px | Use |
|---|---|---|
| `card` | 24 | Cards, bottom sheets |
| `chip` | 999 | Chips, pills, segmented controls |
| `button` | 999 | Primary buttons |
| `icon-btn` | 999 | The two circular header buttons (44×44) |

Shadows: one. `0 2px 24px rgba(17,18,20,0.06)`. Cards only. Never on buttons.

---

## Components

**Primary button** — full-width, `ink` fill, `bg` text, 56 tall, `button` radius, 24 side margin. One per screen.

**Secondary button** — `fill`, `ink-mute` text. Sits directly above the primary. (`No thanks` / `Enable reminders`.)

**Journal line** — `body` text left, `number` right, tabular. Exercise numbers use `ink-mute` and a leading `-`. Weight lines show `✓` instead of a number.

**Summary card** — pinned bottom, `surface`, `card` radius, shadow. Ring progress left, `cals / goal` and `cals left`, macro triple right. Grab handle at top. Tap → bottom sheet.

**Segmented control** — `fill` track, `surface` thumb, `chip` radius, spring on change.

**Progress bar (onboarding)** — two tracks, chapter one short, chapter two long.

---

## Motion

Three animations total, and no more.

1. **Resolve shimmer** — described above
2. **Number settle** — resolved calorie fades and rises 4px, 180ms
3. **Sheet spring** — standard iOS sheet physics

No page transitions beyond the platform default. No confetti. No haptics on logging food — logging food is not an achievement.

---

## Accessibility

- Dynamic Type up to `xxLarge`; the journal line must reflow, the number must not wrap
- Minimum contrast 4.5:1 for `ink-mute` on `bg` (verify: currently 4.6:1)
- Every icon button has an `accessibilityLabel`
- `prefers-reduced-motion` disables the shimmer and the settle
- VoiceOver reads a journal line as `"2 rotis, 220 calories"` — one utterance, not two
