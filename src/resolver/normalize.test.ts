import { describe, expect, it } from 'vitest';

import { normalize, splitEntries } from './normalize';

// spec/05 step 1: lowercase, strip punctuation, collapse whitespace,
// transliterate common Hinglish → canonical. The output is the GLOBAL cache
// key (spec/04 resolution_cache.normalized_text), so every rule here must be
// deterministic and conservative: orthography only, never food semantics —
// dish synonyms (chapati vs roti) belong to dishes.aliases, not here.

describe('normalize', () => {
  it('lowercases, trims, collapses whitespace', () => {
    expect(normalize('  2  Roti   ')).toBe('2 roti');
  });

  it('strips punctuation noise', () => {
    expect(normalize('2 roti!!')).toBe('2 roti');
    expect(normalize('dal (homemade)')).toBe('dal homemade');
  });

  it('keeps decimals between digits', () => {
    expect(normalize('1.5 katori dal')).toBe('1.5 katori dal');
  });

  it('drops thousands separators inside numbers', () => {
    expect(normalize('12,000 steps')).toBe('12000 steps');
  });

  it('converts digit fractions to decimals', () => {
    expect(normalize('1/2 roti')).toBe('0.5 roti');
    expect(normalize('3/4 katori rice')).toBe('0.75 katori rice');
  });

  it('does not divide by a zero denominator (the slash survives as separator)', () => {
    expect(normalize('1/0 roti')).toBe('1 0 roti');
  });

  it('leaves ordinary words that are not unit or number words alone', () => {
    expect(normalize('paneer tikka')).toBe('paneer tikka');
  });

  it('transliterates Devanagari digits', () => {
    expect(normalize('२ roti')).toBe('2 roti');
  });

  it('maps Hindi number words to digits at word boundaries only', () => {
    expect(normalize('ek katori dal')).toBe('1 katori dal');
    expect(normalize('do roti')).toBe('2 roti');
    expect(normalize('dosa')).toBe('dosa'); // "do" must not fire inside a word
    expect(normalize('char idli')).toBe('4 idli');
  });

  it('maps English number words to digits', () => {
    expect(normalize('two eggs')).toBe('2 eggs');
    expect(normalize('one glass milk')).toBe('1 glass milk');
  });

  it('maps half words to 0.5', () => {
    expect(normalize('half roti')).toBe('0.5 roti');
    expect(normalize('aadha katori rice')).toBe('0.5 katori rice');
  });

  it('singularizes unit words only, not foods', () => {
    expect(normalize('2 rotis')).toBe('2 roti');
    expect(normalize('2 glasses water')).toBe('2 glass water');
    expect(normalize('2 eggs')).toBe('2 eggs'); // egg is a food, not a unit
  });

  it('canonicalizes unit spellings', () => {
    expect(normalize('200 gms rice')).toBe('200 g rice');
    expect(normalize('2 kgs chicken')).toBe('2 kg chicken');
    expect(normalize('30 mins walk')).toBe('30 minutes walk');
    expect(normalize('1 hr yoga')).toBe('1 hours yoga');
    expect(normalize('1 litre water')).toBe('1 l water');
  });

  it('is idempotent (cache key stability)', () => {
    const once = normalize('  Ek Katori DAL!! ');
    expect(normalize(once)).toBe(once);
  });
});

describe('splitEntries', () => {
  it('splits on aur', () => {
    expect(splitEntries('2 roti aur 1 katori dal')).toEqual(['2 roti', '1 katori dal']);
  });

  it('splits on and, comma, plus', () => {
    expect(splitEntries('chai and 2 biscuits')).toEqual(['chai', '2 biscuits']);
    expect(splitEntries('poha, chai')).toEqual(['poha', 'chai']);
    expect(splitEntries('roti + dal')).toEqual(['roti', 'dal']);
  });

  it('returns single segment when no conjunction', () => {
    expect(splitEntries('rajma chawal')).toEqual(['rajma chawal']);
  });

  it('drops empty segments', () => {
    expect(splitEntries('chai and ')).toEqual(['chai']);
  });
});
