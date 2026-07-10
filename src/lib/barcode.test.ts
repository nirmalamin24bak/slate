import { describe, expect, it } from 'vitest';

import { parseOffResponse } from './barcode';

// Only the pure parser is tested here (spec/02 §D). fetchOffProduct hits the
// network and is exercised on device. parseOffResponse must never fabricate an
// energy value it doesn't have, and must reject anything unusable rather than
// guess (a hallucinated number is a bug, not an estimate — non-negotiable #3).

const BARCODE = '8901234567890';

describe('parseOffResponse', () => {
  it('status !== 1 → null (product not found)', () => {
    expect(parseOffResponse(BARCODE, { status: 0, product: { product_name: 'x' } })).toBeNull();
    expect(
      parseOffResponse(BARCODE, { status: undefined, product: { product_name: 'x' } }),
    ).toBeNull();
  });

  it('missing product → null even when status is 1', () => {
    expect(parseOffResponse(BARCODE, { status: 1 })).toBeNull();
  });

  it('missing / blank product_name → null (nothing to label the line)', () => {
    expect(parseOffResponse(BARCODE, { status: 1, product: {} })).toBeNull();
    expect(parseOffResponse(BARCODE, { status: 1, product: { product_name: '   ' } })).toBeNull();
    expect(parseOffResponse(BARCODE, { status: 1, product: { product_name: 42 } })).toBeNull();
  });

  it('maps name and energy-kcal_100g when present', () => {
    const food = parseOffResponse(BARCODE, {
      status: 1,
      product: { product_name: 'Marie Biscuit', nutriments: { 'energy-kcal_100g': 450 } },
    });
    expect(food).toEqual({ barcode: BARCODE, name: 'Marie Biscuit', kcal100g: 450 });
  });

  it('prepends the brand to the name when present', () => {
    const food = parseOffResponse(BARCODE, {
      status: 1,
      product: {
        product_name: 'Marie Gold',
        brands: 'Britannia',
        nutriments: { 'energy-kcal_100g': 450 },
      },
    });
    expect(food?.name).toBe('Britannia Marie Gold');
  });

  it('ignores a blank brand (does not prepend an empty prefix)', () => {
    const food = parseOffResponse(BARCODE, {
      status: 1,
      product: { product_name: 'Marie Gold', brands: '   ' },
    });
    expect(food?.name).toBe('Marie Gold');
  });

  it('kcal100g is null when energy is absent — never fabricated', () => {
    const food = parseOffResponse(BARCODE, {
      status: 1,
      product: { product_name: 'Mystery Snack' },
    });
    expect(food?.kcal100g).toBeNull();
  });

  it('kcal100g is null when energy is non-numeric or not finite', () => {
    const asString = parseOffResponse(BARCODE, {
      status: 1,
      product: { product_name: 'X', nutriments: { 'energy-kcal_100g': '450' } },
    });
    expect(asString?.kcal100g).toBeNull();

    const asNaN = parseOffResponse(BARCODE, {
      status: 1,
      product: { product_name: 'X', nutriments: { 'energy-kcal_100g': Number.NaN } },
    });
    expect(asNaN?.kcal100g).toBeNull();

    const asInfinity = parseOffResponse(BARCODE, {
      status: 1,
      product: { product_name: 'X', nutriments: { 'energy-kcal_100g': Number.POSITIVE_INFINITY } },
    });
    expect(asInfinity?.kcal100g).toBeNull();
  });

  it('kcal100g is null when a nutriments object is present but the energy key is absent', () => {
    const food = parseOffResponse(BARCODE, {
      status: 1,
      product: { product_name: 'X', nutriments: {} },
    });
    expect(food?.kcal100g).toBeNull();
  });

  it('accepts a zero energy value (0 is a real number, not "missing")', () => {
    const food = parseOffResponse(BARCODE, {
      status: 1,
      product: { product_name: 'Diet Soda', nutriments: { 'energy-kcal_100g': 0 } },
    });
    expect(food?.kcal100g).toBe(0);
  });

  it('non-object bodies → null', () => {
    expect(parseOffResponse(BARCODE, null)).toBeNull();
    expect(parseOffResponse(BARCODE, undefined)).toBeNull();
    expect(parseOffResponse(BARCODE, 'not json')).toBeNull();
    expect(parseOffResponse(BARCODE, 42)).toBeNull();
  });
});
