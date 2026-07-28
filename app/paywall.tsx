// Paywall (spec/02 §O11, spec/07). Appears once after Start and from every
// Plus gate. Always dismissible — free is the product, Plus is a tip with
// benefits. No interstitials, no "3 of 5 free logs", no nagging.
//
// A user can buy without ever signing in: the purchase attaches to their Apple
// ID via StoreKit, aliased to auth.uid() at boot. Refunds go through Apple —
// said plainly, the sharpest differentiator in the category.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { track } from '@/lib/analytics';
import { reportError } from '@/lib/report';
import { getPlusPrices, purchasePlus, restorePurchases, type PlusPlan } from '@/lib/revenuecat';
import {
  accent,
  primaryButtonHeight,
  radius,
  screenPadding,
  spacing,
  type,
  useTheme,
} from '@/theme';

// spec/07 prices, shown when StoreKit is unreachable (Expo Go / offline). The
// store's localized priceString wins when present.
const FALLBACK: { monthly: string; yearly: string } = { monthly: '₹199', yearly: '₹1,499' };

const FREE = [
  'Unlimited entries',
  'Barcode & label scan',
  'Macros',
  'Weight & exercise',
  'Streak',
  'Hide calorie counts',
  'Export your data',
  '30-day history',
] as const;

// App Store 2.1: the paywall may only advertise features that actually work in
// the shipping build. Widgets, Photo logging, Chat, Apple Health, and Custom
// dishes are still stubs — list each again here as it ships. (Audit C1.)
const PLUS = [
  'Stats',
  'Fiber & sugar',
  'Kitchen calibration',
  'Saved foods',
  'Full history',
] as const;

function Column({ title, items }: { title: string; items: readonly string[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.column}>
      <Text style={[type.label, { color: colors.ink }]}>{title}</Text>
      {items.map((item) => (
        <Text key={item} style={[type.caption, styles.item, { color: colors.inkMute }]}>
          {item}
        </Text>
      ))}
    </View>
  );
}

export default function Paywall() {
  const { colors } = useTheme();
  const router = useRouter();
  const [prices, setPrices] = useState(FALLBACK);
  const [busy, setBusy] = useState(false);
  // Which gate sent the user here. Unknown values fall back to 'settings' — the
  // param is a route string and this keeps PaywallGate closed (spec/08: no free
  // text reaches an event payload, even from our own navigation).
  const { gate } = useLocalSearchParams<{ gate?: string }>();

  useEffect(() => {
    track({
      name: 'paywall_viewed',
      gate: gate === 'history_depth' ? 'history_depth' : 'settings',
    });
  }, [gate]);

  useEffect(() => {
    let mounted = true;
    getPlusPrices()
      .then((p) => {
        if (!mounted) return;
        setPrices({ monthly: p.monthly ?? FALLBACK.monthly, yearly: p.yearly ?? FALLBACK.yearly });
      })
      .catch((error: unknown) => reportError(error, { screen: 'paywall' }));
    return () => {
      mounted = false;
    };
  }, []);

  const dismiss = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const buy = async (plan: PlusPlan) => {
    if (busy) return;
    setBusy(true);
    try {
      const { plus } = await purchasePlus(plan);
      if (plus) {
        track({ name: 'purchase_completed', plan });
        dismiss();
      }
    } catch {
      // Apple's own cancel/failure sheet already told the user; no toast.
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { plus } = await restorePurchases();
      if (plus) dismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[type.title, styles.heading, { color: colors.ink }]}>Slate Plus</Text>

        <View style={styles.columns}>
          <Column title="Free" items={FREE} />
          <Column title="Plus" items={PLUS} />
        </View>

        <Text style={[type.caption, styles.refund, { color: colors.inkMute }]}>
          Purchases and refunds go through Apple. We don&apos;t hold the money.
        </Text>

        <View style={styles.plans}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void buy('yearly')}
            style={[styles.primary, { backgroundColor: colors.ink }]}
          >
            <Text style={[type.body, { color: colors.bg }]}>
              Yearly {prices.yearly} · 7-day trial
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void buy('monthly')}
            style={[styles.secondary, { backgroundColor: colors.fill }]}
          >
            <Text style={[type.body, { color: colors.ink }]}>Monthly {prices.monthly}</Text>
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" onPress={() => void restore()} style={styles.textBtn}>
          <Text style={[type.caption, { color: accent }]}>Restore purchases</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={dismiss} style={styles.textBtn}>
          <Text style={[type.body, { color: colors.inkMute }]}>No thanks</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: screenPadding,
    paddingVertical: spacing.xl,
  },
  heading: {
    marginBottom: spacing.lg,
  },
  columns: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  column: {
    flex: 1,
    gap: spacing.xs,
  },
  item: {
    lineHeight: 22,
  },
  refund: {
    marginTop: spacing.lg,
  },
  plans: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  primary: {
    height: primaryButtonHeight,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    height: primaryButtonHeight,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtn: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
});
