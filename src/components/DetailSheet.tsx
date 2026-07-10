// Entry detail sheet (spec/02 §B): the text as an editable chip, calories,
// macros with percentages and a stacked bar. Nickname a line to save it —
// saving IS renaming; there is no favourite button. Delete is quiet.
//
// Unresolved lines get the honest copy (spec/09): "Not sure what this is.
// Try adding detail?"

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DayLine } from '@/journal';
import { numberProps, radius, spacing, type, useTheme } from '@/theme';

import { Sheet } from './Sheet';

function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export interface DetailSheetProps {
  line: DayLine | null;
  hideCalories: boolean;
  onClose(): void;
  onEditText(id: string, text: string): void;
  onNickname(id: string, nickname: string | null): void;
  onDelete(id: string): void;
  onRetry(id: string): void;
}

export function DetailSheet({
  line,
  hideCalories,
  onClose,
  onEditText,
  onNickname,
  onDelete,
  onRetry,
}: DetailSheetProps) {
  const { colors, macros } = useTheme();
  // Parent keys this component by entry id, so lazy state re-initialises per
  // line — no effect-driven sync needed.
  const [text, setText] = useState(line?.entry.raw_text ?? '');
  const [nickname, setNickname] = useState(line?.entry.nickname ?? '');

  if (!line)
    return (
      <Sheet visible={false} onClose={onClose}>
        {null}
      </Sheet>
    );
  const { entry, display } = line;

  const grams = (entry.protein_g ?? 0) + (entry.carbs_g ?? 0) + (entry.fat_g ?? 0);
  const isFood = entry.intent === 'food' && entry.status === 'resolved';

  const commitText = () => {
    const trimmed = text.trim();
    if (trimmed.length > 0 && trimmed !== entry.raw_text) onEditText(entry.id, trimmed);
  };
  const commitNickname = () => {
    const trimmed = nickname.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if (next !== entry.nickname) onNickname(entry.id, next);
  };

  return (
    <Sheet visible onClose={onClose}>
      <TextInput
        value={text}
        onChangeText={setText}
        onBlur={commitText}
        onSubmitEditing={commitText}
        returnKeyType="done"
        accessibilityLabel="Entry text"
        style={[type.body, styles.chip, { backgroundColor: colors.fill, color: colors.ink }]}
      />

      {display.kind === 'retry' && (
        <Pressable
          onPress={() => onRetry(entry.id)}
          accessibilityRole="button"
          accessibilityLabel="Not sure what this is. Try adding detail? Retry"
        >
          <Text style={[type.label, styles.rowGap, { color: colors.inkMute }]}>
            Not sure what this is. Try adding detail? ↻
          </Text>
        </Pressable>
      )}

      {isFood && !hideCalories && entry.kcal !== null && (
        <Text {...numberProps} style={[type.heroNumber, styles.rowGap, { color: colors.ink }]}>
          {Math.round(entry.kcal).toLocaleString('en-IN')}
          <Text style={[type.label, { color: colors.inkMute }]}> cals</Text>
        </Text>
      )}

      {isFood && grams > 0 && (
        <>
          <View style={styles.bar}>
            {(
              [
                [entry.protein_g ?? 0, macros.protein],
                [entry.carbs_g ?? 0, macros.carbs],
                [entry.fat_g ?? 0, macros.fat],
              ] as const
            ).map(([value, color], i) => (
              <View
                key={i}
                style={{ flex: Math.max(value, 0.001), backgroundColor: color, height: 6 }}
              />
            ))}
          </View>
          <View style={styles.macroRow}>
            {(
              [
                ['protein', entry.protein_g ?? 0, macros.protein],
                ['carbs', entry.carbs_g ?? 0, macros.carbs],
                ['fat', entry.fat_g ?? 0, macros.fat],
              ] as const
            ).map(([label, value, color]) => (
              <View key={label} style={styles.macro}>
                <Text {...numberProps} style={[type.number, { color: colors.ink }]}>
                  {Math.round(value)}g · {pct(value, grams)}
                </Text>
                <Text style={[type.caption, { color }]}>{label}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <TextInput
        value={nickname}
        onChangeText={setNickname}
        onBlur={commitNickname}
        onSubmitEditing={commitNickname}
        placeholder="Nickname to save"
        placeholderTextColor={colors.inkMute}
        returnKeyType="done"
        accessibilityLabel="Nickname to save this entry"
        style={[
          type.body,
          styles.chip,
          styles.rowGap,
          { backgroundColor: colors.fill, color: colors.ink },
        ]}
      />

      <Pressable
        onPress={() => onDelete(entry.id)}
        accessibilityRole="button"
        accessibilityLabel="Delete entry"
        style={styles.rowGap}
      >
        <Text style={[type.label, { color: colors.inkMute }]}>Delete entry</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowGap: {
    marginTop: spacing.md,
  },
  bar: {
    flexDirection: 'row',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  macro: {
    alignItems: 'flex-start',
  },
});
