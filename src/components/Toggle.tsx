// A plain switch row (spec/02 §F Customize display, §G hub toggles). Label
// left, optional Plus badge, the switch right. Wraps RN Switch so the accent
// colour is applied in one place.

import { StyleSheet, Switch, Text, View } from 'react-native';

import { accent, spacing, type, useTheme } from '@/theme';

import { PlusBadge } from './PlusBadge';

export interface ToggleProps {
  label: string;
  value: boolean;
  onValueChange(value: boolean): void;
  plus?: boolean;
  disabled?: boolean;
}

export function Toggle({ label, value, onValueChange, plus, disabled }: ToggleProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={[type.body, { color: disabled ? colors.inkMute : colors.ink }]}>{label}</Text>
        {plus && <PlusBadge />}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: accent, false: colors.fill }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.fill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
});
