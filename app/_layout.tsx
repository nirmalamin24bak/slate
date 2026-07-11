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
import { Appearance, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRemoteConfig } from '@/lib/remoteConfig';
import { reportError } from '@/lib/report';
import { services } from '@/lib/services';
import { dark, light, ThemeModeProvider, type, useTheme } from '@/theme';

// expo-router renders this in place of a route that threw during render. It
// sits above the theme provider and must survive a broken tree, so it reads
// the scheme straight from Appearance and pulls raw palette — no hooks, no
// context. Voice: state the fact, offer the action, no apology (BRAND-VOICE 3).
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  reportError(error, { boundary: 'root' });
  const colors = Appearance.getColorScheme() === 'dark' ? dark : light;
  return (
    <View style={[styles.fallback, { backgroundColor: colors.bg }]}>
      <Text style={[type.body, { color: colors.ink }]}>Slate stopped.</Text>
      <Text style={[type.body, styles.fallbackHint, { color: colors.inkMute }]}>
        Your journal is saved. Reopen to continue.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={[styles.fallbackButton, { backgroundColor: colors.ink }]}
      >
        <Text style={[type.body, { color: colors.bg }]}>Reopen</Text>
      </Pressable>
    </View>
  );
}

// Keep the native splash up until fonts are ready. The journal must never
// flash a fallback face — numbers in the wrong font jitter when Inter Tight
// swaps in (spec/03: tabular figures, no jitter).
SplashScreen.preventAutoHideAsync();

function BreachBanner() {
  const { breachBanner } = useRemoteConfig();
  const theme = useTheme();
  if (!breachBanner) return null;
  // Remote-controlled security notice (docs/breach-playbook.md). Plain, factual,
  // dismissed only by the flag going null server-side.
  return (
    <View style={[styles.banner, { backgroundColor: theme.colors.ink }]}>
      <Text style={[type.label, { color: theme.colors.bg }]}>{breachBanner}</Text>
    </View>
  );
}

function ThemedStack() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <BreachBanner />
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

  // On foreground, re-read the authoritative entitlement so a subscription
  // bought or lapsed elsewhere converges without a relaunch (plan B2).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void services()
          .then((s) => s.refreshEntitlement())
          .catch((error: unknown) => reportError(error, { op: 'foregroundEntitlement' }));
      }
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null; // splash is still visible
  }

  return (
    <ThemeModeProvider>
      <ThemedStack />
    </ThemeModeProvider>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  fallbackHint: {
    textAlign: 'center',
    marginBottom: 16,
  },
  banner: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  fallbackButton: {
    height: 56,
    paddingHorizontal: 32,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
