import { useColorScheme } from 'react-native';

import { dark, light, macros, type ColorScheme, type Palette } from './colors';

export interface Theme {
  scheme: ColorScheme;
  colors: Palette;
  macros: (typeof macros)[ColorScheme];
}

// Follows the system appearance (app.json userInterfaceStyle: automatic).
// A manual dark-mode override lives in Settings later (spec/02 §F); when it
// lands, it feeds this hook — components never read useColorScheme directly.
export function useTheme(): Theme {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return {
    scheme,
    colors: scheme === 'dark' ? dark : light,
    macros: macros[scheme],
  };
}
