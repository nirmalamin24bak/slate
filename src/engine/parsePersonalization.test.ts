import { describe, expect, test } from 'vitest';
import { parsePersonalization } from './parsePersonalization';

// The parser (spec/05) reads profiles.personalization free text into bounded
// direction factors. It is a keyword matcher, not an LLM: only a handful of
// cooking habits move a factor, and the engine clamps whatever comes out. These
// tests assert DIRECTION and that a matched phrase produces a factor — the exact
// clamped values are the engine's job (personalization.test.ts), not the parser's.

describe('parsePersonalization', () => {
  test('null / empty text → null (no effect)', () => {
    expect(parsePersonalization(null)).toBeNull();
    expect(parsePersonalization('')).toBeNull();
  });

  test('an unrecognized phrase → null so recompute skips the step', () => {
    expect(parsePersonalization('everything I eat is 50 calories')).toBeNull();
    expect(parsePersonalization('i love dosa')).toBeNull();
  });

  describe('oil → fat factor, total left untouched', () => {
    test('"very little oil" sets fat < 1 (aggressive cut)', () => {
      const f = parsePersonalization('very little oil');
      expect(f?.fat).toBeLessThan(1);
      expect(f?.total).toBeUndefined();
    });

    test('"no oil" / "hardly any oil" / "minimal oil" all cut fat', () => {
      expect(parsePersonalization('no oil')?.fat).toBeLessThan(1);
      expect(parsePersonalization('hardly any oil')?.fat).toBeLessThan(1);
      expect(parsePersonalization('minimal oil')?.fat).toBeLessThan(1);
    });

    test('"less oil" is a milder cut than "very little oil"', () => {
      const less = parsePersonalization('less oil')?.fat ?? 0;
      const veryLittle = parsePersonalization('very little oil')?.fat ?? 0;
      expect(less).toBeLessThan(1);
      expect(less).toBeGreaterThan(veryLittle); // milder → closer to 1
    });

    test('"lots of oil" / "extra oil" / "heavy oil" set fat > 1', () => {
      expect(parsePersonalization('lots of oil')?.fat).toBeGreaterThan(1);
      expect(parsePersonalization('extra oil')?.fat).toBeGreaterThan(1);
      expect(parsePersonalization('heavy oil')?.fat).toBeGreaterThan(1);
    });
  });

  describe('portion / appetite → total factor', () => {
    test('"small katori" sets total < 1', () => {
      const f = parsePersonalization('small katori');
      expect(f?.total).toBeLessThan(1);
      expect(f?.fat).toBeUndefined();
    });

    test('"light eater" sets total < 1', () => {
      expect(parsePersonalization('light eater')?.total).toBeLessThan(1);
    });

    test('"low-cal" (and "low cal") sets total < 1', () => {
      expect(parsePersonalization('low-cal')?.total).toBeLessThan(1);
      expect(parsePersonalization('low cal')?.total).toBeLessThan(1);
    });

    test('"big eater" sets total > 1', () => {
      const f = parsePersonalization('big eater');
      expect(f?.total).toBeGreaterThan(1);
    });

    test('"large portion" sets total > 1', () => {
      expect(parsePersonalization('large portion')?.total).toBeGreaterThan(1);
    });
  });

  describe('combination and case', () => {
    test('combined phrases multiply: "small katori, low-cal" is more than either alone', () => {
      const both = parsePersonalization('small katori, low-cal')?.total ?? 1;
      const one = parsePersonalization('small katori')?.total ?? 1;
      expect(both).toBeLessThan(one); // two 0.7s multiply to 0.49, below one 0.7
      expect(both).toBeGreaterThan(0);
    });

    test('oil and portion phrases together set both factors', () => {
      const f = parsePersonalization('big eater with lots of oil');
      expect(f?.total).toBeGreaterThan(1);
      expect(f?.fat).toBeGreaterThan(1);
    });

    test('case-insensitive', () => {
      expect(parsePersonalization('VERY LITTLE OIL')?.fat).toBeLessThan(1);
      expect(parsePersonalization('Big Eater')?.total).toBeGreaterThan(1);
    });
  });
});
