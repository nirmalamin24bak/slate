// Settings/list row (spec/02 §F): label left, optional value + Plus badge +
// chevron right. One row shape across Settings, the drawer sheets, and the
// info screens, so the app reads as one surface.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { numberProps, spacing, type, useTheme } from '@/theme';

import { PlusBadge } from './PlusBadge';

export interface ListRowProps {
  label: string;
  /** grey current value on the right, e.g. '2,400' or 'On' */
  value?: string;
  plus?: boolean;
  chevron?: boolean;
  onPress?(): void;
}

export function ListRow({ label, value, plus, chevron = true, onPress }: ListRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      style={styles.row}
    >
      <Text style={[type.body, styles.label, { color: colors.ink }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.right}>
        {value !== undefined && (
          <Text {...numberProps} style={[type.number, { color: colors.inkMute }]}>
            {value}
          </Text>
        )}
        {plus && <PlusBadge />}
        {chevron && <Text style={[type.body, { color: colors.inkMute }]}>›</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  label: {
    flexShrink: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
