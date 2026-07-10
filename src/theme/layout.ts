import type { ViewStyle } from 'react-native';

// spec/03-DESIGN-SYSTEM.md — Spacing, Radius, Shadows, Motion.

// Base unit 4. Screen padding 24. Vertical rhythm between journal lines 20.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

export const screenPadding = spacing.lg;
export const journalLineGap = 20;

export const radius = {
  card: 24, // cards, bottom sheets
  chip: 999, // chips, pills, segmented controls
  button: 999, // primary buttons
  iconBtn: 999, // the two circular header buttons (44×44)
} as const;

export const iconButtonSize = 44;
export const primaryButtonHeight = 56;

// One shadow. Cards only. Never on buttons.
export const cardShadow: ViewStyle = {
  shadowColor: '#111214',
  shadowOffset: { width: 0, height: 2 },
  shadowRadius: 24,
  shadowOpacity: 0.06,
  elevation: 4, // Android approximation; iOS is the target platform
};

// Three animations total, and no more (spec/03 Motion):
// 1. resolve shimmer  2. number settle  3. sheet spring (platform default)
export const motion = {
  shimmerDurationMs: 900, // ease-out, respects prefers-reduced-motion
  settleDurationMs: 180,
  settleRisePx: 4,
} as const;
