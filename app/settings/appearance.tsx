// Dark mode (spec/02 §F). Three states; 'System' follows the OS. Display
// preference, not health data — stays local, out of sync.

import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { screenPadding, spacing, useTheme, useThemeMode } from '@/theme';

export default function Appearance() {
  const { colors } = useTheme();
  const { mode, setMode } = useThemeMode();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Dark mode" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Segmented
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={mode}
          onChange={setMode}
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
    paddingTop: spacing.md,
  },
});
