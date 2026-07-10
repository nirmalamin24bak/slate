// Saved foods (spec/02 §F). There is no favourites button — a nickname on a
// journal line is what saves it. Empty state teaches exactly that. Tapping one
// re-logs it to today.

import { Redirect, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListRow } from '@/components/ListRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { listSavedFoods } from '@/db/entriesRepo';
import type { EntryRow } from '@/db/rows';
import { queueLine } from '@/lib/pendingLine';
import { usePlus } from '@/lib/plus';
import { services } from '@/lib/services';
import { screenPadding, spacing, type, useTheme } from '@/theme';

export default function SavedFoods() {
  const { colors } = useTheme();
  const router = useRouter();
  const plus = usePlus();
  const [saved, setSaved] = useState<EntryRow[]>([]);

  useEffect(() => {
    if (!plus) return;
    let mounted = true;
    services().then(async (svc) => {
      const rows = await listSavedFoods(svc.adapter, svc.userId);
      if (mounted) setSaved(rows);
    });
    return () => {
      mounted = false;
    };
  }, [plus]);

  // Defense in depth: Saved foods is Plus (spec/07). The caller already gates,
  // but a direct navigation lands on the paywall, not the list.
  if (!plus) return <Redirect href={'/paywall' as Href} />;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Saved foods" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {saved.length === 0 ? (
          <Text style={[type.label, styles.empty, { color: colors.inkMute }]}>
            Add a nickname to a journal entry to save it.
          </Text>
        ) : (
          saved.map((row) => (
            <ListRow
              key={row.id}
              label={row.nickname ?? row.raw_text}
              chevron={false}
              onPress={() => {
                queueLine(row.raw_text);
                router.dismissAll();
              }}
            />
          ))
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
  empty: {
    paddingVertical: spacing.xl,
  },
});
