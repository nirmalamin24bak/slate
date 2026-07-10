// The bottom sheet behind the summary card (spec/02 §B). Everything except
// food is off by default; these rows are how a user turns the rest on. Plus
// rows route free users to the paywall instead of the destination.

import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePlus } from '@/lib/plus';
import { spacing, type, useTheme } from '@/theme';

import { PlusBadge } from './PlusBadge';
import { Sheet } from './Sheet';

interface OptionRow {
  label: string;
  plus: boolean;
  route: string;
}

const ROWS: readonly OptionRow[] = [
  { label: 'Your info & goals', plus: false, route: '/settings/info-goals' },
  { label: 'Your kitchen', plus: true, route: '/settings/kitchen' },
  { label: 'Customize display', plus: false, route: '/settings/display' },
  { label: 'Fiber and sugar', plus: true, route: '/settings/display' },
  { label: 'What you can write', plus: false, route: '/settings/hub' },
];

export function OptionsSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { colors } = useTheme();
  const router = useRouter();
  const plus = usePlus();

  const go = (row: Pick<OptionRow, 'plus' | 'route'>) => {
    onClose();
    const target = row.plus && !plus ? '/paywall' : row.route;
    router.push(target as Href);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Pressable
        style={styles.row}
        accessibilityRole="button"
        onPress={() => go({ plus: true, route: '/chat' })}
      >
        <Text style={[type.body, { color: colors.ink }]}>Chat about your day →</Text>
        {!plus && <PlusBadge />}
      </Pressable>
      <View style={[styles.divider, { backgroundColor: colors.hairline }]} />
      {ROWS.map((row) => (
        <Pressable
          key={row.label}
          style={styles.row}
          accessibilityRole="button"
          onPress={() => go(row)}
        >
          <Text style={[type.body, { color: colors.ink }]}>{row.label}</Text>
          <View style={styles.rowRight}>
            {row.plus && !plus && <PlusBadge />}
            <Text style={[type.body, { color: colors.inkMute }]}>›</Text>
          </View>
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xs,
  },
});
