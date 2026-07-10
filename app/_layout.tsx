import {
  InterTight_500Medium,
  InterTight_700Bold,
  InterTight_800ExtraBold,
} from '@expo-google-fonts/inter-tight';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { ThemeModeProvider, useTheme } from '@/theme';

// Keep the native splash up until fonts are ready. The journal must never
// flash a fallback face — numbers in the wrong font jitter when Inter Tight
// swaps in (spec/03: tabular figures, no jitter).
SplashScreen.preventAutoHideAsync();

function ThemedStack() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  // Keys are the names src/theme/typography.ts refers to. Loading mechanism
  // can change (config plugin, custom TTFs); the names must not.
  const [fontsLoaded, fontError] = useFonts({
    'InterTight-Medium': InterTight_500Medium,
    'InterTight-Bold': InterTight_700Bold,
    'InterTight-ExtraBold': InterTight_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null; // splash is still visible
  }

  return (
    <ThemeModeProvider>
      <ThemedStack />
    </ThemeModeProvider>
  );
}
