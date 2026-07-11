// Manual appearance override (spec/02 §F — Settings → Dark mode).
// 'system' follows the OS; 'light'/'dark' pin it. Persisted locally — display
// preference, not health data, so it stays out of profiles/sync.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const MODE_KEY = 'slate.themeMode.v1';

interface ThemeModeValue {
  mode: ThemeMode;
  setMode(mode: ThemeMode): void;
}

const ThemeModeContext = createContext<ThemeModeValue>({
  mode: 'system',
  setMode: () => undefined,
});

function isMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(MODE_KEY).then((stored) => {
      if (mounted && isMode(stored)) setModeState(stored);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(MODE_KEY, next);
  }, []);

  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>{children}</ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeValue {
  return useContext(ThemeModeContext);
}
