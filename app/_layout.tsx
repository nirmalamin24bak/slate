import {
  InterTight_500Medium,
  InterTight_700Bold,
  InterTight_800ExtraBold,
} from '@expo-google-fonts/inter-tight';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useGlobalSearchParams } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { PostHogProvider } from 'posthog-react-native';

import { useTheme } from '@/theme';
import { posthog } from '@/config/posthog';

// Keep the native splash up until fonts are ready. The journal must never
// flash a fallback face — numbers in the wrong font jitter when Inter Tight
// swaps in (spec/03: tabular figures, no jitter).
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useTheme();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const previousPathname = useRef<string | undefined>(undefined);

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

  // Manual screen tracking for expo-router
  useEffect(() => {
    if (previousPathname.current !== pathname) {
      posthog.screen(pathname, { previous_screen: previousPathname.current ?? null, ...params });
      previousPathname.current = pathname;
    }
  }, [pathname, params]);

  if (!fontsLoaded && !fontError) {
    return null; // splash is still visible
  }

  return (
    <PostHogProvider
      client={posthog}
      autocapture={{
        captureScreens: false,
        captureTouches: true,
        propsToCapture: ['testID'],
        maxElementsCaptured: 20,
      }}
    >
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
        }}
      />
    </PostHogProvider>
  );
}
