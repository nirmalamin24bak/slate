// A teach sheet (spec/02 §G). Icon, title, a sentence or two, three tappable
// examples, a toggle, Done. Tapping an example inserts it into the journal and
// closes the sheet — reading becomes a logged entry in one tap, the entire
// onboarding for that intent.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

import { PlusBadge } from './PlusBadge';
import { Sheet } from './Sheet';
import { Toggle } from './Toggle';

export interface TeachContent {
  icon: string;
  title: string;
  body: string;
  examples: readonly string[];
  /** food is always on and has no toggle */
  alwaysOn?: boolean;
  plus?: boolean;
}

export interface TeachSheetProps {
  content: TeachContent | null;
  enabled: boolean;
  locked: boolean; // Plus intent, user is free
  onToggle(value: boolean): void;
  onInsertExample(text: string): void;
  onClose(): void;
}

export function TeachSheet({
  content,
  enabled,
  locked,
  onToggle,
  onInsertExample,
  onClose,
}: TeachSheetProps) {
  const { colors } = useTheme();
  if (!content) return null;

  return (
    <Sheet visible={content !== null} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.icon}>{content.icon}</Text>
        <Text style={[type.title, { color: colors.ink }]}>{content.title}</Text>
        {content.plus && <PlusBadge />}
      </View>

      <Text style={[type.body, styles.body, { color: colors.inkMute }]}>{content.body}</Text>

      <View style={styles.examples}>
        {content.examples.map((example) => (
          <Pressable
            key={example}
            accessibilityRole="button"
            accessibilityLabel={`Add ${example}`}
            onPress={() => onInsertExample(example)}
            style={[styles.example, { backgroundColor: colors.fill }]}
          >
            <Text style={[type.body, { color: colors.ink }]}>{example}</Text>
            <Text style={[type.body, { color: colors.inkMute }]}>✎</Text>
          </Pressable>
        ))}
      </View>

      {!content.alwaysOn && (
        <View style={styles.toggle}>
          <Toggle
            label={locked ? 'Enable with Plus' : 'Show in journal'}
            value={enabled}
            disabled={locked}
            onValueChange={onToggle}
          />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  icon: {
    fontSize: 28,
  },
  body: {
    marginTop: spacing.sm,
  },
  examples: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  example: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  toggle: {
    marginTop: spacing.md,
  },
});
