// The design system as a typed module (spec/03-DESIGN-SYSTEM.md).
// Components import from '@/theme' and never carry raw hex, raw px,
// or fontVariant literals.

export { accent, dark, light, macros, shimmer } from './colors';
export type { ColorScheme, Palette } from './colors';
export {
  cardShadow,
  iconButtonSize,
  journalLineGap,
  motion,
  primaryButtonHeight,
  radius,
  screenPadding,
  spacing,
} from './layout';
export { fontFamily, tabular, type } from './typography';
export type { TypeRole } from './typography';
export { useTheme } from './useTheme';
export type { Theme } from './useTheme';
