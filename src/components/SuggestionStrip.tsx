// Suggestion strip (spec/02 §B): recents and saved foods above the keyboard,
// one tap to insert. Free feature. Quiet chips, no icons, no counts.

import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { radius, screenPadding, spacing, type, useTheme } from '@/theme';

export interface Suggestion {
  label: string;
  /** what tapping inserts into the journal */
  text: string;
}

// Memoized: on the keystroke-critical journal, this sits beside the composer
// and must not re-render per character. Its props (suggestions, onPick) are
// stable across keystrokes, so memo makes typing skip it entirely.
function SuggestionStripImpl({
  suggestions,
  onPick,
}: {
  suggestions: readonly Suggestion[];
  onPick(text: string): void;
}) {
  const { colors } = useTheme();
  if (suggestions.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      style={styles.strip}
    >
      {suggestions.map((s) => (
        <Pressable
          key={s.label}
          onPress={() => onPick(s.text)}
          accessibilityRole="button"
          accessibilityLabel={`Insert ${s.label}`}
          style={[styles.chip, { backgroundColor: colors.fill }]}
        >
          <Text style={[type.label, { color: colors.ink }]}>{s.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export const SuggestionStrip = memo(SuggestionStripImpl);

const styles = StyleSheet.create({
  strip: {
    flexGrow: 0,
  },
  content: {
    paddingHorizontal: screenPadding,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chip: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
