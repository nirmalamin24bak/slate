import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { screenPadding, spacing, type, useTheme } from '@/theme';

// Journal (home) — Phase 0 scaffold.
// The real multiline editor, line state machine, shimmer, totals, and
// summary card are built in Phase 3 (spec/02 §B, spec/09). This screen
// exists so the app boots to the journal route with the correct tokens,
// and to prove tabular figures on a live number.
export default function Journal() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[type.title, { color: colors.ink }]}>Today</Text>
        <Text style={[type.number, styles.total, { color: colors.inkMute }]}>0 cals</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
  },
  total: {
    marginTop: spacing.xs,
  },
});
