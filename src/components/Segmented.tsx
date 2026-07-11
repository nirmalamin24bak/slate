// Segmented control (spec/03: pill radius, fill for inactive, surface for
// active). Used by Stats ranges, the scanner tabs, and the dark-mode picker.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
}

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const { colors } = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.fill }]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && { backgroundColor: colors.surface }]}
          >
            <Text style={[type.label, { color: active ? colors.ink : colors.inkMute }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.chip,
    padding: 3,
  },
  segment: {
    flex: 1,
    borderRadius: radius.chip,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
});
