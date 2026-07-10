// "What you can write" — the teaching hub (spec/02 §G). The only place a user
// discovers the text field accepts more than food, and the per-intent toggle.
// Reached from Settings and the summary-card options sheet.

import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlusBadge } from '@/components/PlusBadge';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TeachSheet } from '@/components/TeachSheet';
import { useDisplayToggles } from '@/lib/displayToggles';
import { INTENT_CARDS, type IntentCard } from '@/lib/intents';
import { queueLine } from '@/lib/pendingLine';
import { usePlus } from '@/lib/plus';
import { screenPadding, spacing, type, useTheme } from '@/theme';

export default function Hub() {
  const { colors } = useTheme();
  const router = useRouter();
  const plus = usePlus();
  const { state, setToggle } = useDisplayToggles();
  const [open, setOpen] = useState<IntentCard | null>(null);

  const enabledOf = (card: IntentCard): boolean =>
    card.alwaysOn || (state !== null && card.toggleKey !== null && state[card.toggleKey]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="What you can write" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {INTENT_CARDS.map((card) => {
          const locked = card.plus === true && !plus;
          return (
            <Pressable
              key={card.title}
              accessibilityRole="button"
              onPress={() => setOpen(card)}
              style={styles.row}
            >
              <View style={styles.left}>
                <Text style={styles.icon}>{card.icon}</Text>
                <Text style={[type.body, { color: colors.ink }]}>{card.title}</Text>
              </View>
              <View style={styles.right}>
                {locked && <PlusBadge />}
                <Text style={[type.caption, { color: colors.inkMute }]}>
                  {card.alwaysOn ? 'always on' : enabledOf(card) ? 'on' : 'off'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <TeachSheet
        content={open}
        enabled={open ? enabledOf(open) : false}
        locked={open?.plus === true && !plus}
        onToggle={(v) => {
          if (!open || open.toggleKey === null) return;
          setToggle(open.toggleKey, v);
        }}
        onInsertExample={(text) => {
          // Sleep is Plus: a free user's tap routes to the paywall, not a log.
          if (open?.plus === true && !plus) {
            setOpen(null);
            router.push('/paywall' as Href);
            return;
          }
          queueLine(text);
          setOpen(null);
          router.dismissAll();
        }}
        onClose={() => setOpen(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    fontSize: 22,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
