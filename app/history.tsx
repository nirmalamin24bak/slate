// History (spec/02 §C drawer). A list of logged days; tapping one opens the
// journal on that day. Free tier reaches 30 days back; past that, one quiet
// Plus row (spec/09 empty states) — no blur, no tease.

import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListRow } from '@/components/ListRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { listDaySummaries, type DaySummary } from '@/db/entriesRepo';
import { getProfile } from '@/db/profileRepo';
import { dayKey, isWithinFreeWindow } from '@/journal';
import { usePlus } from '@/lib/plus';
import { services } from '@/lib/services';
import { screenPadding, spacing, type, useTheme } from '@/theme';

function dayLabel(key: string, today: string): string {
  if (key === today) return 'Today';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function History() {
  const { colors } = useTheme();
  const router = useRouter();
  const plus = usePlus();
  const [days, setDays] = useState<DaySummary[]>([]);
  const [hideCalories, setHideCalories] = useState(false);
  const today = dayKey(new Date());

  useEffect(() => {
    let mounted = true;
    services().then(async (svc) => {
      const summaries = await listDaySummaries(svc.adapter, svc.userId, 400);
      const profile = await getProfile(svc.adapter, svc.userId);
      if (!mounted) return;
      setDays(summaries);
      setHideCalories((profile?.hide_calories ?? 0) === 1);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const visible = plus ? days : days.filter((d) => isWithinFreeWindow(d.log_date, today));
  const clipped = !plus && visible.length < days.length;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="History" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {visible.map((day) => (
          <ListRow
            key={day.log_date}
            label={dayLabel(day.log_date, today)}
            value={
              hideCalories
                ? `${day.entry_count.toLocaleString('en-IN')} ${day.entry_count === 1 ? 'entry' : 'entries'}`
                : `${Math.round(day.net_kcal).toLocaleString('en-IN')} cals`
            }
            onPress={() => router.push(`/?day=${day.log_date}` as Href)}
          />
        ))}
        {clipped && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/paywall' as Href)}
            style={styles.plusRow}
          >
            <Text style={[type.label, { color: colors.inkMute }]}>
              Slate Plus keeps your full history.
            </Text>
          </Pressable>
        )}
        {days.length === 0 && (
          <View style={styles.empty}>
            <Text style={[type.label, { color: colors.inkMute }]}>Nothing logged yet.</Text>
          </View>
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
  plusRow: {
    paddingVertical: spacing.md,
  },
  empty: {
    paddingVertical: spacing.xl,
  },
});
