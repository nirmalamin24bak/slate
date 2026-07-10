// Stats (spec/02 §E) — Plus. Free users see one quiet row, no blurred fakes.
// Segmented Week/Month/Year/Range; cards in order: Calories (bar, average),
// Weight (line, latest), Macros (avg, %), Fiber & sugar (if enabled).

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CalorieBars } from '@/components/CalorieBars';
import { RangeCalendar } from '@/components/RangeCalendar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { WeightLine } from '@/components/WeightLine';
import { listDayStats, type DayStatRow } from '@/db/entriesRepo';
import { getProfile, listWeights } from '@/db/profileRepo';
import { addDays, dayKey } from '@/journal';
import { usePlus } from '@/lib/plus';
import { services } from '@/lib/services';
import {
  caloriesCard,
  fiberSugarCard,
  macrosCard,
  rangeFor,
  weightSeries,
  type RangeKind,
  type StatsRange,
  type WeightPoint,
} from '@/stats/aggregate';
import { cardShadow, radius, screenPadding, spacing, type, useTheme } from '@/theme';

const RANGE_OPTIONS: readonly { value: RangeKind; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'range', label: 'Range' },
];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, cardShadow, { backgroundColor: colors.surface }]}>
      <Text style={[type.label, { color: colors.inkMute }]}>{title}</Text>
      {children}
    </View>
  );
}

export default function Stats() {
  const { colors, macros } = useTheme();
  const plus = usePlus();
  const today = dayKey(new Date());

  const [kind, setKind] = useState<RangeKind>('week');
  const [custom, setCustom] = useState<StatsRange>({ start: addDays(today, -6), end: today });
  const range = kind === 'range' ? custom : rangeFor(kind, today);

  const [stats, setStats] = useState<DayStatRow[]>([]);
  const [weights, setWeights] = useState<WeightPoint[]>([]);
  const [showFiberSugar, setShowFiberSugar] = useState(false);
  const [hideCalories, setHideCalories] = useState(false);

  useEffect(() => {
    if (!plus) return;
    let mounted = true;
    services().then(async (svc) => {
      const [dayStats, weightRows, profile] = await Promise.all([
        listDayStats(svc.adapter, svc.userId, range.start, range.end),
        listWeights(svc.adapter, svc.userId),
        getProfile(svc.adapter, svc.userId),
      ]);
      if (!mounted) return;
      setStats(dayStats);
      setWeights(weightRows.map((w) => ({ log_date: w.log_date, weight_kg: w.weight_kg })));
      setShowFiberSugar((profile?.show_fiber_sugar ?? 0) === 1);
      setHideCalories((profile?.hide_calories ?? 0) === 1);
    });
    return () => {
      mounted = false;
    };
  }, [plus, range.start, range.end]);

  const calories = useMemo(() => caloriesCard(stats, range), [stats, range]);
  const macroAvg = useMemo(() => macrosCard(stats), [stats]);
  const fiberSugar = useMemo(() => fiberSugarCard(stats), [stats]);
  const weightPts = useMemo(() => weightSeries(weights, range), [weights, range]);
  const latestWeight = weightPts.length > 0 ? weightPts[weightPts.length - 1] : null;

  if (!plus) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
        <ScreenHeader title="Stats" />
        <View style={styles.freeRow}>
          <Text style={[type.label, { color: colors.inkMute }]}>Slate Plus shows your trends.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Stats" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Segmented<RangeKind> options={RANGE_OPTIONS} value={kind} onChange={setKind} />

        {kind === 'range' && (
          <View style={[styles.card, cardShadow, { backgroundColor: colors.surface }]}>
            <RangeCalendar
              start={custom.start}
              end={custom.end}
              onChange={(start, end) => setCustom({ start, end })}
            />
          </View>
        )}

        {!hideCalories && (
          <Card title="Calories">
            <View style={styles.headline}>
              <Text style={[type.heroNumber, { color: colors.ink }]}>
                {calories.averageKcal !== null
                  ? Math.round(calories.averageKcal).toLocaleString('en-IN')
                  : '_'}
              </Text>
              <Text style={[type.caption, { color: colors.inkMute }]}>average</Text>
            </View>
            <CalorieBars buckets={calories.buckets} />
          </Card>
        )}

        <Card title="Weight">
          {weightPts.length === 0 ? (
            <Text style={[type.label, styles.emptyLine, { color: colors.inkMute }]}>
              No weight entries yet
            </Text>
          ) : (
            <>
              <View style={styles.headline}>
                <Text style={[type.heroNumber, { color: colors.ink }]}>
                  {latestWeight?.weight_kg.toFixed(1)} kg
                </Text>
                <Text style={[type.caption, { color: colors.inkMute }]}>latest</Text>
              </View>
              <WeightLine points={weightPts} />
            </>
          )}
        </Card>

        <Card title="Macros">
          {macroAvg.loggedDays === 0 ? (
            <Text style={[type.label, styles.emptyLine, { color: colors.inkMute }]}>
              Nothing logged in this range
            </Text>
          ) : (
            <>
              <View style={styles.macroRow}>
                {(
                  [
                    {
                      label: 'protein',
                      grams: macroAvg.proteinG,
                      share: macroAvg.proteinShare,
                      color: macros.protein,
                    },
                    {
                      label: 'carbs',
                      grams: macroAvg.carbsG,
                      share: macroAvg.carbsShare,
                      color: macros.carbs,
                    },
                    {
                      label: 'fat',
                      grams: macroAvg.fatG,
                      share: macroAvg.fatShare,
                      color: macros.fat,
                    },
                  ] as const
                ).map((m) => (
                  <View key={m.label} style={styles.macroCol}>
                    <Text style={[type.number, { color: colors.ink }]}>{Math.round(m.grams)}g</Text>
                    <Text style={[type.caption, { color: colors.inkMute }]}>
                      {m.label} · {Math.round(m.share * 100)}%
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.stack}>
                <View
                  style={{
                    flex: Math.max(macroAvg.proteinShare, 0.001),
                    backgroundColor: macros.protein,
                  }}
                />
                <View style={styles.stackGap} />
                <View
                  style={{
                    flex: Math.max(macroAvg.carbsShare, 0.001),
                    backgroundColor: macros.carbs,
                  }}
                />
                <View style={styles.stackGap} />
                <View
                  style={{ flex: Math.max(macroAvg.fatShare, 0.001), backgroundColor: macros.fat }}
                />
              </View>
            </>
          )}
        </Card>

        {showFiberSugar && (
          <Card title="Fiber & sugar">
            <View style={styles.macroRow}>
              <View style={styles.macroCol}>
                <Text style={[type.number, { color: colors.ink }]}>
                  {Math.round(fiberSugar.fiberG)}g
                </Text>
                <Text style={[type.caption, { color: colors.inkMute }]}>fiber · avg</Text>
              </View>
              <View style={styles.macroCol}>
                <Text style={[type.number, { color: colors.ink }]}>
                  {Math.round(fiberSugar.sugarG)}g
                </Text>
                <Text style={[type.caption, { color: colors.inkMute }]}>sugar · avg</Text>
              </View>
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  freeRow: {
    paddingHorizontal: screenPadding,
    paddingVertical: spacing.md,
  },
  card: {
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.md,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  emptyLine: {
    paddingVertical: spacing.sm,
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  macroCol: {
    gap: 2,
  },
  stack: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  stackGap: {
    width: 2,
  },
});
