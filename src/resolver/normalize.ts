// spec/05 step 1. The output is the global cache key
// (resolution_cache.normalized_text), so rules are orthographic only and must
// be deterministic and idempotent. Food semantics — chapati vs roti, pohe vs
// poha — live in dishes.aliases and the model's catalogue, never here.

const DEVANAGARI_ZERO = 0x0966;

/** Hindi + English number words → digits. Word-boundary matches only. */
const NUMBER_WORDS: Readonly<Record<string, string>> = {
  ek: '1',
  do: '2',
  teen: '3',
  char: '4',
  chaar: '4',
  paanch: '5',
  panch: '5',
  che: '6',
  chhe: '6',
  saat: '7',
  aath: '8',
  ath: '8',
  nau: '9',
  das: '10',
  dus: '10',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  half: '0.5',
  aadha: '0.5',
  adha: '0.5',
};

/**
 * Unit-word spellings → the spec/05 unit vocabulary. Only measurement words —
 * singularizing a food ("2 eggs") would fork cache keys for no gain.
 */
const UNIT_WORDS: Readonly<Record<string, string>> = {
  gm: 'g',
  gms: 'g',
  gram: 'g',
  grams: 'g',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  mls: 'ml',
  ltr: 'l',
  litre: 'l',
  litres: 'l',
  liter: 'l',
  liters: 'l',
  kms: 'km',
  min: 'minutes',
  mins: 'minutes',
  minute: 'minutes',
  hr: 'hours',
  hrs: 'hours',
  hour: 'hours',
  rotis: 'roti',
  katoris: 'katori',
  glasses: 'glass',
  cups: 'cup',
  plates: 'plate',
  pieces: 'piece',
  tbsps: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsps: 'tsp',
};

function mapWords(text: string, map: Readonly<Record<string, string>>): string {
  return text.replace(/[a-z]+/g, (word) => map[word] ?? word);
}

export function normalize(raw: string): string {
  let s = raw.toLowerCase();

  // Devanagari digits → ASCII.
  s = s.replace(/[०-९]/g, (d) => String(d.codePointAt(0)! - DEVANAGARI_ZERO));

  // Thousands separators: "12,000" → "12000".
  while (/\d,\d/.test(s)) s = s.replace(/(\d),(\d)/g, '$1$2');

  // Digit fractions → decimals: "1/2" → "0.5".
  s = s.replace(/(\d+)\s*\/\s*(\d+)/g, (m, a: string, b: string) => {
    const den = Number(b);
    if (den === 0) return m;
    return String(Math.round((Number(a) / den) * 1000) / 1000);
  });

  // Keep '.' only as a decimal point; everything non-alphanumeric → space.
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  s = s.replace(/[^\p{L}\p{N}\s.]/gu, ' ');

  s = mapWords(s, NUMBER_WORDS);
  s = mapWords(s, UNIT_WORDS);

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic multi-entry split (spec/05: "2 roti aur ek katori dal" is two
 * entries; split at the resolver, not the UI). Runs BEFORE normalize so each
 * segment gets its own cache key — resolution_cache holds one resolution per
 * key, so an unsplit compound line could never cache.
 */
export function splitEntries(raw: string): string[] {
  return raw
    .split(/,|\+|\s+aur\s+|\s+and\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
