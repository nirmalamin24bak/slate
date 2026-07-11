import { useColorScheme } from 'react-native';

import { dark, light, macros, type ColorScheme, type Palette } from './colors';
import { useThemeMode } from './mode';

export interface Theme {
  scheme: ColorScheme;
  colors: Palette;
  macros: (typeof macros)[ColorScheme];
}

// Follows the system appearance (app.json userInterfaceStyle: automatic)
// unless Settings → Dark mode pins it. Components never read useColorScheme
// directly — this hook is the single source of the active scheme.
export function useTheme(): Theme {
  const system = useColorScheme();
  const { mode } = useThemeMode();
  const scheme: ColorScheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  return {
    scheme,
    colors: scheme === 'dark' ? dark : light,
    macros: macros[scheme],
  };
}
