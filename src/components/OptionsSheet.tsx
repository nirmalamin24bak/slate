// The bottom sheet behind the summary card (spec/02 §B). Rows route to
// screens that land in Phase 5; until then they render but do nothing —
// the layout contract is Phase 3's, the destinations are not.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { accent, radius, spacing, type, useTheme } from '@/theme';

import { Sheet } from './Sheet';

const ROWS = [
  { label: 'Your info & goals', plus: false },
  { label: 'Your kitchen', plus: true },
  { label: 'Customize display', plus: false },
  { label: 'Fiber and sugar', plus: true },
  { label: 'What you can write', plus: false },
] as const;

function PlusBadge() {
  return (
    <View style={styles.plusBadge}>
      <Text style={[type.caption, { color: '#FFFFFF' }]}>Plus</Text>
    </View>
  );
}

export function OptionsSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Pressable style={styles.row} accessibilityRole="button">
        <Text style={[type.body, { color: colors.ink }]}>Chat about your day →</Text>
        <PlusBadge />
      </Pressable>
      <View style={[styles.divider, { backgroundColor: colors.hairline }]} />
      {ROWS.map((row) => (
        <Pressable key={row.label} style={styles.row} accessibilityRole="button">
          <Text style={[type.body, { color: colors.ink }]}>{row.label}</Text>
          <View style={styles.rowRight}>
            {row.plus && <PlusBadge />}
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
  plusBadge: {
    backgroundColor: accent,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
