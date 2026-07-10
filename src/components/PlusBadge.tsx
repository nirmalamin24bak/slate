// The Plus chip (spec/02) — indigo, tiny, never decorative. One source so the
// badge reads identically on the options sheet, drawer, settings, and hub.

import { StyleSheet, Text, View } from 'react-native';

import { accent, radius, spacing, type } from '@/theme';

export function PlusBadge() {
  return (
    <View style={styles.badge}>
      <Text style={[type.caption, styles.text]}>Plus</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: accent,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  text: {
    color: '#FFFFFF',
  },
});
