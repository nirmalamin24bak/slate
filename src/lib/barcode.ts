// Barcode lookup (spec/02 §D). Free. Our packaged_foods table first (corrected
// by us), then Open Food Facts as a fallback. A hit produces a journal line
// the resolver already understands — `<qty> g <name>` maps to the packaged_foods
// ref — so scanning shares the whole write-through path with typing.
//
// The OFF response parser is pure and tested; the fetch is a thin wrapper. No
// raw scan text ever reaches analytics; the barcode is not personal data but
// the food is, so the same discipline applies (spec/08).

export interface BarcodeFood {
  barcode: string;
  name: string;
  /** null when OFF has no per-100g energy — we can't fabricate one */
  kcal100g: number | null;
}

interface OffProduct {
  product_name?: unknown;
  brands?: unknown;
  nutriments?: { 'energy-kcal_100g'?: unknown };
}

interface OffResponse {
  status?: unknown;
  product?: OffProduct;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Parse an Open Food Facts v2 product payload. Returns null when unusable. */
export function parseOffResponse(barcode: string, body: unknown): BarcodeFood | null {
  if (typeof body !== 'object' || body === null) return null;
  const res = body as OffResponse;
  if (res.status !== 1 || !res.product) return null;
  const name = str(res.product.product_name);
  const brand = str(res.product.brands);
  if (!name) return null;
  return {
    barcode,
    name: brand ? `${brand} ${name}` : name,
    kcal100g: num(res.product.nutriments?.['energy-kcal_100g']),
  };
}

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

/**
 * Fetch a barcode from Open Food Facts. Network-facing; callers try the local
 * packaged_foods mirror first. Returns null on any failure (offline, 404,
 * unparseable) — the scanner shows the honest "not in our database yet" line.
 */
export async function fetchOffProduct(
  barcode: string,
  signal?: AbortSignal,
): Promise<BarcodeFood | null> {
  try {
    const res = await fetch(
      `${OFF_ENDPOINT}/${encodeURIComponent(barcode)}.json?fields=product_name,brands,nutriments`,
      { signal },
    );
    if (!res.ok) return null;
    return parseOffResponse(barcode, await res.json());
  } catch {
    return null;
  }
}
