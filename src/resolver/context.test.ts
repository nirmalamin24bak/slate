import { describe, expect, it } from 'vitest';

import { contextOf, OUTSIDE_TOKENS_LIST } from './context';

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

  // Pin the exact token set. The edge function (resolver-classify/index.ts)
  // hand-mirrors this list to reconstruct context on the cache-write side; a
  // silent change here would drift the two and cache wrong-context rows. If
  // this fails, update BOTH the client list and the edge copy together.
  it('token set is exactly the reviewed list', () => {
    expect([...OUTSIDE_TOKENS_LIST]).toEqual([
      'swiggy',
      'zomato',
      'ordered',
      'outside',
      'hotel',
      'restaurant',
      'canteen',
      'bahar',
      'dhaba',
    ]);
  });
});
