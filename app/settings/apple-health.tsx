// Apple Health (spec/02 §F, Plus). HealthKit is a native entitlement that
// ships with the standalone build, not Expo Go. Route-guarded to Plus at the
// caller. FLAG(nirmal): HealthKit capability + steps/weight read scopes not
// yet declared; the import writes steps entries with source='health' and a
// manual line supersedes it on the same day (spec/09).

import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { screenPadding, spacing, type, useTheme } from '@/theme';

export default function AppleHealth() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Apple Health" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[type.label, { color: colors.inkMute }]}>
          Importing steps and weight from Apple Health arrives in the next build. A line you type
          always wins over an imported one.
        </Text>
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
    paddingTop: spacing.md,
  },
});
