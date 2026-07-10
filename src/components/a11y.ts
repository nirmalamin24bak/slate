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
