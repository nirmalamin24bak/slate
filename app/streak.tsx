// Streak (spec/02 §E0). Two numbers and the dots. No copy beyond them —
// breaking is silent, and nothing here knows what a calorie is.

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { listLoggedDates } from '@/db/entriesRepo';
import { computeStreak, consistencyDots, dayKey, type StreakInfo } from '@/journal';
import { services } from '@/lib/services';
import { numberProps, screenPadding, spacing, type, useTheme } from '@/theme';

const DOT_WEEKS = 8;

export default function Streak() {
  const { colors } = useTheme();
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [dots, setDots] = useState<boolean[][]>([]);

  useEffect(() => {
    let mounted = true;
    services().then(async (svc) => {
      const dates = await listLoggedDates(svc.adapter, svc.userId);
      if (!mounted) return;
      const today = dayKey(new Date());
      setStreak(computeStreak(dates, today));
      setDots(consistencyDots(dates, today, DOT_WEEKS));
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Streak" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {streak && (
          <>
            <Text {...numberProps} style={[type.heroNumber, styles.hero, { color: colors.ink }]}>
              {streak.current.toLocaleString('en-IN')}
            </Text>
            <Text style={[type.label, { color: colors.inkMute }]}>days</Text>

            <View style={styles.longestRow}>
              <Text style={[type.label, { color: colors.inkMute }]}>Longest</Text>
              <Text {...numberProps} style={[type.number, { color: colors.ink }]}>
                {streak.longest.toLocaleString('en-IN')} days
              </Text>
            </View>

            <View style={styles.weeks} accessibilityLabel="Logged days, most recent on the right">
              {dots.map((week, w) => (
                <View key={w} style={styles.week}>
                  {week.map((filled, d) => (
                    <View
                      key={d}
                      style={[
                        styles.dot,
                        filled
                          ? { backgroundColor: colors.ink }
                          : {
                              backgroundColor: 'transparent',
                              borderWidth: 1,
                              borderColor: colors.hairline,
                            },
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
          </>
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
  },
  hero: {
    marginTop: spacing.xl,
  },
  longestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
  },
  weeks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  week: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 16,
    borderRadius: 2,
  },
});
