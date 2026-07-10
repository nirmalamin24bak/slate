import { describe, expect, it } from 'vitest';

import { contextOf } from './context';

// spec/05: context "outside" if the text implies restaurant/hotel/delivery
// (swiggy, zomato, ordered, outside, hotel, restaurant, canteen), else home.
// Must be a pure function of the normalized text: resolution_cache has no
// context column, so a cache hit reconstructs context from the text alone.

describe('contextOf', () => {
  it('flags delivery and restaurant tokens', () => {
    expect(contextOf('dal makhani from swiggy')).toBe('outside');
    expect(contextOf('ordered biryani zomato')).toBe('outside');
    expect(contextOf('lunch at hotel')).toBe('outside');
    expect(contextOf('office canteen thali')).toBe('outside');
    expect(contextOf('restaurant dosa')).toBe('outside');
    expect(contextOf('ate outside')).toBe('outside');
  });

  it('defaults to home', () => {
    expect(contextOf('2 roti')).toBe('home');
    expect(contextOf('1 katori dal')).toBe('home');
  });

  it('matches whole words only', () => {
    expect(contextOf('hotelier biography')).toBe('home'); // no token as a word
  });
});
