// Your info & goals (spec/02 §F). Export sits at the bottom and is free —
// DPDP makes it a right, not a feature.

import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListRow } from '@/components/ListRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { getProfile } from '@/db/profileRepo';
import type { ProfileRow } from '@/db/rows';
import { usePlus } from '@/lib/plus';
import { services } from '@/lib/services';
import { screenPadding, spacing, type, useTheme } from '@/theme';

export default function InfoGoals() {
  const { colors } = useTheme();
  const router = useRouter();
  const plus = usePlus();
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      services().then(async (svc) => {
        const row = await getProfile(svc.adapter, svc.userId);
        if (mounted) setProfile(row);
      });
      return () => {
        mounted = false;
      };
    }, []),
  );

  const push = (route: string) => router.push(route as Href);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Your info & goals" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <ListRow
          label="Calorie goal"
          value={
            profile?.calorie_goal != null ? profile.calorie_goal.toLocaleString('en-IN') : undefined
          }
          onPress={() => push('/settings/goal')}
        />
        <ListRow label="Macro goals" onPress={() => push('/settings/macro-goals')} />
        <ListRow label="Your body (BMR)" onPress={() => push('/settings/body')} />
        <ListRow
          label="Saved foods"
          plus={!plus}
          onPress={() => push(plus ? '/settings/saved-foods' : '/paywall')}
        />
        <ListRow label="Personalization" onPress={() => push('/settings/personalization')} />
        {/* Apple Health is a stub — hidden until built so a Plus user isn't sent
            to a non-working paid feature (App Store 2.1, audit C1). Restore with
            the paywall bullet when it ships. */}

        <Pressable
          accessibilityRole="button"
          onPress={() => push('/settings/export')}
          style={styles.exportRow}
        >
          <Text style={[type.label, { color: colors.inkMute }]}>↓ Export your data</Text>
        </Pressable>
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
  exportRow: {
    marginTop: spacing.xl,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
});
