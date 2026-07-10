import type { TextStyle } from 'react-native';

// spec/03-DESIGN-SYSTEM.md — Type scale.
// Inter Tight, one family, all weights. Sentence case throughout.
// No all-caps. No italics.
//
// RN letterSpacing is in px, not em: value = em × fontSize, computed here
// once so no component ever does the arithmetic.
//
// Font family names match the keys loaded in src/theme/fonts.ts.

export const fontFamily = {
  medium: 'InterTight-Medium', // 500
  bold: 'InterTight-Bold', // 700
  extraBold: 'InterTight-ExtraBold', // 800
} as const;

// Tabular figures everywhere a number appears. Non-negotiable (CLAUDE.md):
// calories change as the resolver returns; digits must not jitter.
export const tabular: Pick<TextStyle, 'fontVariant'> = {
  fontVariant: ['tabular-nums'],
};

export const type = {
  // Onboarding headlines
  display: {
    fontFamily: fontFamily.extraBold,
    fontSize: 40,
    letterSpacing: -1.2, // -0.03em × 40
  },
  // Screen titles (`Stats`, `Today`)
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 28,
    letterSpacing: -0.56, // -0.02em × 28
  },
  // `85.0 kg`, `0 cals` in Stats
  heroNumber: {
    fontFamily: fontFamily.bold,
    fontSize: 44,
    letterSpacing: -0.88, // -0.02em × 44
    ...tabular,
  },
  // Journal lines, list rows
  body: {
    fontFamily: fontFamily.medium,
    fontSize: 17,
    letterSpacing: -0.17, // -0.01em × 17
  },
  // Calorie values (tabular)
  number: {
    fontFamily: fontFamily.medium,
    fontSize: 17,
    letterSpacing: 0,
    ...tabular,
  },
  // `protein`, `carbs`, `fat`
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    letterSpacing: 0,
  },
  // Grey subtext, `Research sources`
  caption: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    letterSpacing: 0,
  },
} as const satisfies Record<string, TextStyle>;

// spec/03 Accessibility: Dynamic Type up to xxLarge. Text reflows; a number
// never wraps. Numbers cap their font scaling at the xxLarge step (iOS
// fontScale ≈ 1.35 there) while body copy keeps scaling with the system
// setting. numberOfLines: 1 is the hard guarantee; the cap keeps the digits
// fitting rather than ellipsizing.
export const numberMaxFontScale = 1.35;

export const numberProps = {
  numberOfLines: 1,
  maxFontSizeMultiplier: numberMaxFontScale,
} as const;

export type TypeRole = keyof typeof type;
