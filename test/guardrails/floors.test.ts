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
    // macros nests per colour-scheme in source (colors.ts), so pin each scheme.
    expect(Object.keys(macros.light).sort()).toEqual(['carbs', 'fat', 'protein']);
    expect(Object.keys(macros.dark).sort()).toEqual(['carbs', 'fat', 'protein']);
    expect(accent).toBe('#3E5C9E');
  });
});
