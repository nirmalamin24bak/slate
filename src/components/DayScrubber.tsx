// Day scrubber (spec/02 §B): pull down on "Today" → a horizontal strip of
// days. Backdating is a swipe, not a date picker. Free tier reaches 30 days
// back (spec/09); beyond that a quiet Plus row. Future dates are Plus.

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDays, FREE_HISTORY_DAYS } from '@/journal';
import { radius, screenPadding, spacing, type, useTheme } from '@/theme';

function label(key: string, today: string): string {
  if (key === today) return 'Today';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
  return date.toLocaleDateString('en-IN', { weekday: 'short' });
}

export interface DayScrubberProps {
  today: string;
  selected: string;
  onSelect(key: string): void;
  onDone(): void;
}

export function DayScrubber({ today, selected, onSelect, onDone }: DayScrubberProps) {
  const { colors } = useTheme();
  const days = Array.from({ length: FREE_HISTORY_DAYS + 1 }, (_, i) =>
    addDays(today, i - FREE_HISTORY_DAYS),
  );

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        // most recent on the right; open scrolled to the end
        ref={(ref) => ref?.scrollToEnd({ animated: false })}
      >
        <Pressable style={styles.chip} accessibilityRole="button">
          <Text style={[type.caption, { color: colors.inkMute }]}>View all history</Text>
        </Pressable>
        {days.map((key) => {
          const active = key === selected;
          return (
            <Pressable
              key={key}
              onPress={() => onSelect(key)}
              accessibilityRole="button"
              accessibilityLabel={key === today ? 'Today' : key}
              style={[styles.chip, active && { backgroundColor: colors.fill }]}
            >
              <Text style={[type.label, { color: active ? colors.ink : colors.inkMute }]}>
                {label(key, today)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={onDone} style={styles.chip} accessibilityRole="button">
          <Text style={[type.label, { color: colors.ink }]}>done</Text>
        </Pressable>
      </ScrollView>
      {selected !== today && (
        <Pressable
          onPress={() => onSelect(today)}
          accessibilityRole="button"
          style={[styles.todayPill, { backgroundColor: colors.ink }]}
        >
          <Text style={[type.label, { color: colors.bg }]}>Go to today</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  strip: {
    paddingHorizontal: screenPadding,
    gap: spacing.xs,
    alignItems: 'center',
  },
  chip: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  todayPill: {
    alignSelf: 'center',
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
