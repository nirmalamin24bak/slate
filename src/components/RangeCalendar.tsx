// The Range calendar (spec/02 §E): a plain month grid. A tap moves the end
// date; tapping a date twice moves the start date — the instruction renders
// verbatim under the grid.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { dayKey } from '@/journal';
import { numberProps, radius, spacing, type, useTheme } from '@/theme';

export interface RangeCalendarProps {
  start: string;
  end: string;
  onChange(start: string, end: string): void;
}

interface MonthCell {
  key: string | null; // null pads the leading weekday offset
  day: number;
}

function monthCells(year: number, month: number): MonthCell[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: null, day: 0 });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ key: dayKey(new Date(year, month, d, 12)), day: d });
  }
  return cells;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export function RangeCalendar({ start, end, onChange }: RangeCalendarProps) {
  const { colors } = useTheme();
  const [ym, setYm] = useState(() => {
    const [y, m] = end.split('-').map(Number);
    return { year: y ?? new Date().getFullYear(), month: (m ?? 1) - 1 };
  });
  const [lastTap, setLastTap] = useState<string | null>(null);

  const tap = (key: string) => {
    if (lastTap === key) {
      // second tap on the same date → it becomes the start
      onChange(key, end >= key ? end : key);
    } else {
      onChange(start <= key ? start : key, key);
    }
    setLastTap(key);
  };

  const title = new Date(ym.year, ym.month, 15).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <View>
      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() =>
            setYm((v) => ({
              year: v.month === 0 ? v.year - 1 : v.year,
              month: (v.month + 11) % 12,
            }))
          }
        >
          <Text style={[type.body, { color: colors.inkMute }]}>‹</Text>
        </Pressable>
        <Text style={[type.label, { color: colors.ink }]}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={() =>
            setYm((v) => ({
              year: v.month === 11 ? v.year + 1 : v.year,
              month: (v.month + 1) % 12,
            }))
          }
        >
          <Text style={[type.body, { color: colors.inkMute }]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {WEEKDAYS.map((w, i) => (
          <View key={`w${i}`} style={styles.cell}>
            <Text style={[type.caption, { color: colors.inkMute }]}>{w}</Text>
          </View>
        ))}
        {monthCells(ym.year, ym.month).map((cell, i) =>
          cell.key === null ? (
            <View key={`pad${i}`} style={styles.cell} />
          ) : (
            <Pressable
              key={cell.key}
              accessibilityRole="button"
              accessibilityLabel={cell.key}
              accessibilityState={{ selected: cell.key === start || cell.key === end }}
              onPress={() => tap(cell.key as string)}
              style={[
                styles.cell,
                cell.key >= start && cell.key <= end && { backgroundColor: colors.fill },
                (cell.key === start || cell.key === end) && { backgroundColor: colors.ink },
              ]}
            >
              <Text
                {...numberProps}
                style={[
                  type.number,
                  {
                    color: cell.key === start || cell.key === end ? colors.bg : colors.ink,
                  },
                ]}
              >
                {cell.day}
              </Text>
            </Pressable>
          ),
        )}
      </View>

      <Text style={[type.caption, styles.hint, { color: colors.inkMute }]}>
        Tap a date twice to change the start date.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
  hint: {
    marginTop: spacing.sm,
  },
});
