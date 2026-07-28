// The summary card (spec/02 §B, spec/03): pinned bottom, ring progress left,
// cals / goal and cals left, macro triple right. Grab handle. Tap → options.
//
// Copy discipline (spec/09 Safety): `1,610 cals left` is a fact, never an
// instruction. No green ring, no celebration, whatever the numbers are.
// Hide-calories mode hides every calorie figure; macros remain.
//
// This card is the net-against-goal surface spec/09 governs, so it displays
// the FLOORED net (max(net, 1200)) — the true value is stored, the floor is
// shown, and the day can never read below 1,200 here. (The header's running
// intraday total is a separate surface; see the FLAG in journal/compose.ts.)

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { DayTotals } from '@/journal';
import { cardShadow, numberProps, radius, screenPadding, spacing, type, useTheme } from '@/theme';

import { formatKcal as n, summaryLabel } from './a11y';

const RING_SIZE = 56;
const RING_STROKE = 5;

function Ring({ fraction }: { fraction: number }) {
  const { colors } = useTheme();
  const r = (RING_SIZE - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={r}
        stroke={colors.fill}
        strokeWidth={RING_STROKE}
        fill="none"
      />
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={r}
        stroke={colors.ink}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeDasharray={`${c}`}
        strokeDashoffset={c * (1 - clamped)}
        strokeLinecap="round"
        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
      />
    </Svg>
  );
}

export interface SummaryCardProps {
  totals: DayTotals;
  calorieGoal: number | null;
  hideCalories: boolean;
  showMacros: boolean;
  onPress(): void;
}

// Memoized: pinned on the keystroke-critical journal. With a stable onPress
// from the parent, typing skips re-rendering the ring + macro SVG entirely.
function SummaryCardImpl({
  totals,
  calorieGoal,
  hideCalories,
  showMacros,
  onPress,
}: SummaryCardProps) {
  const { colors, macros } = useTheme();
  const net = totals.flooredNetKcal; // max(net, 1200) — the floor binds here
  const left = calorieGoal === null ? null : calorieGoal - net;

  const calories = hideCalories ? null : (
    <View style={styles.calories}>
      <Text {...numberProps} style={[type.number, { color: colors.ink }]}>
        {n(net)}
        {calorieGoal !== null ? ` / ${n(calorieGoal)}` : ''} cals
      </Text>
      <Text style={[type.caption, { color: colors.inkMute }]}>
        {left !== null
          ? left >= 0
            ? `${n(left)} cals left`
            : `${n(-left)} cals over`
          : 'No goal set'}
        {totals.pendingCount > 0 ? `  ·  +${totals.pendingCount} pending` : ''}
      </Text>
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={summaryLabel(totals, calorieGoal, hideCalories)}
      style={[styles.card, cardShadow, { backgroundColor: colors.surface }]}
    >
      <View style={[styles.handle, { backgroundColor: colors.fill }]} />
      <View style={styles.row}>
        {!hideCalories && (
          <Ring fraction={calorieGoal !== null && calorieGoal > 0 ? net / calorieGoal : 0} />
        )}
        {calories ?? (
          <Text style={[type.caption, styles.calories, { color: colors.inkMute }]}>
            {totals.pendingCount > 0 ? `+${totals.pendingCount} pending` : 'Tap to view options'}
          </Text>
        )}
        {showMacros && (
          <View style={styles.macros}>
            {(
              [
                ['protein', totals.proteinG, macros.protein],
                ['carbs', totals.carbsG, macros.carbs],
                ['fat', totals.fatG, macros.fat],
              ] as const
            ).map(([label, grams, color]) => (
              <View key={label} style={styles.macro}>
                <Text {...numberProps} style={[type.number, { color: colors.ink }]}>
                  {Math.round(grams)}g
                </Text>
                <Text style={[type.caption, { color }]}>{label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

export const SummaryCard = memo(SummaryCardImpl);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: screenPadding,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  calories: {
    flex: 1,
    gap: 2,
  },
  macros: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  macro: {
    alignItems: 'center',
  },
});
