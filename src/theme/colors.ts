// spec/03-DESIGN-SYSTEM.md — Colour.
// Graphite and chalk. The restraint is the brand: if you find yourself
// reaching for the accent, you're decorating.

export const light = {
  bg: '#F7F7F5', // app background
  surface: '#FFFFFF', // cards, sheets
  fill: '#EFEFEC', // chips, input wells, inactive segments
  ink: '#111214', // primary text, primary buttons
  inkMute: '#8A8B90', // secondary text, resolved-negative numbers
  hairline: '#E3E3DF', // dividers
} as const;

export const dark = {
  bg: '#0E0F11',
  surface: '#191A1D',
  fill: '#232428',
  ink: '#F5F5F3',
  inkMute: '#7E7F85',
  hairline: '#2B2C30',
} as const;

// Semantic, used only in macro contexts. Never decorative.
export const macros = {
  light: {
    protein: '#C4553D', // clay
    carbs: '#3E5C9E', // indigo
    fat: '#B8871F', // amber
  },
  dark: {
    protein: '#E0765C',
    carbs: '#6B8BD1',
    fat: '#D9A83C',
  },
} as const;

// Used for: the resolve shimmer, the Plus badge, focus rings. Nothing else.
export const accent = '#3E5C9E';

// Resolve shimmer sweep (spec/03): transparent → mint 12% → indigo 18% → transparent.
// Rendered as a gradient under a resolving line. Respects reduced motion
// (fall back to a static 30%-opacity fill).
export const shimmer = {
  mint: '#7FBFA8',
  mintOpacity: 0.12,
  indigo: '#3E5C9E',
  indigoOpacity: 0.18,
} as const;

export type Palette = Record<keyof typeof light, string>;
export type ColorScheme = 'light' | 'dark';
