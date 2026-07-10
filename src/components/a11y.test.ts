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
