import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchOffProduct, parseOffResponse } from './barcode';

// parseOffResponse must never fabricate an energy value it doesn't have, and
// must reject anything unusable rather than guess (a hallucinated number is a
// bug, not an estimate — non-negotiable #3). fetchOffProduct is a thin wrapper
// around it, tested here against a stubbed fetch: its contract is that EVERY
// failure — offline, 404, unparseable body — returns null so the scanner can
// show the honest "not in our database yet" line instead of throwing into the
// UI (spec/09).

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

describe('fetchOffProduct', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: (url: string, init?: { signal?: AbortSignal }) => unknown) {
    const spy = vi.fn(impl);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('requests only the three fields it needs, with the barcode encoded', async () => {
    const spy = stubFetch(() => ({
      ok: true,
      json: async () => ({ status: 1, product: { product_name: 'Marie Gold' } }),
    }));

    const food = await fetchOffProduct('89012/34567890');

    expect(food?.name).toBe('Marie Gold');
    const url = String(spy.mock.calls[0]?.[0]);
    // The barcode goes into the path, so an unencoded slash would change the
    // route. It is also the ONLY thing we send — no user id, no raw text (spec/08).
    expect(url).toContain('89012%2F34567890.json');
    expect(url).toContain('fields=product_name,brands,nutriments');
    expect(url).not.toContain(BARCODE);
  });

  it('passes the abort signal through so a closed scanner cancels the request', async () => {
    const controller = new AbortController();
    const spy = stubFetch(() => ({ ok: true, json: async () => ({ status: 1 }) }));

    await fetchOffProduct(BARCODE, controller.signal);

    expect(spy.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
  });

  it('a non-ok response → null, and the body is never read', async () => {
    const json = vi.fn();
    stubFetch(() => ({ ok: false, status: 404, json }));

    expect(await fetchOffProduct(BARCODE)).toBeNull();
    expect(json).not.toHaveBeenCalled();
  });

  it('a network failure (offline / abort) → null, never a throw', async () => {
    stubFetch(() => {
      throw new TypeError('Network request failed');
    });

    await expect(fetchOffProduct(BARCODE)).resolves.toBeNull();
  });

  it('an unparseable body → null, never a throw', async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    }));

    await expect(fetchOffProduct(BARCODE)).resolves.toBeNull();
  });

  it('a 200 with an unusable payload → null (the parser decides, not the status)', async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ status: 0 }) }));

    expect(await fetchOffProduct(BARCODE)).toBeNull();
  });
});
