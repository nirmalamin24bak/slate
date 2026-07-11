// Export your data (spec/08 §3). Free, always. JSON + CSV — three files, each
// through the share sheet. FLAG(nirmal): a single zipped bundle needs a zip
// dependency; three explicit files chosen until ruled otherwise.

import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListRow } from '@/components/ListRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { shareExport, type ExportKind } from '@/lib/exportShare';
import { screenPadding, spacing, type, useTheme } from '@/theme';

export default function ExportData() {
  const { colors } = useTheme();
  const [busy, setBusy] = useState<ExportKind | null>(null);

  const run = async (kind: ExportKind) => {
    if (busy) return;
    setBusy(kind);
    try {
      await shareExport(kind);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Export your data" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[type.label, styles.intro, { color: colors.inkMute }]}>
          Everything Slate knows: your profile, kitchen, entries, and weights. Free, always.
        </Text>
        <ListRow
          label={busy === 'json' ? 'Preparing…' : 'Everything (JSON)'}
          chevron={false}
          onPress={() => void run('json')}
        />
        <ListRow
          label={busy === 'entries-csv' ? 'Preparing…' : 'Entries (CSV)'}
          chevron={false}
          onPress={() => void run('entries-csv')}
        />
        <ListRow
          label={busy === 'weights-csv' ? 'Preparing…' : 'Weights (CSV)'}
          chevron={false}
          onPress={() => void run('weights-csv')}
        />
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
  intro: {
    paddingVertical: spacing.md,
  },
});
