// Widget (spec/02 §F, Plus). The home-screen widget is a native WidgetKit
// extension shipped with the dev build — it does not exist in Expo Go. This
// screen explains what it will show; the extension lands with the standalone
// build. FLAG(nirmal): WidgetKit target + shared app group not yet created.

import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { screenPadding, spacing, type, useTheme } from '@/theme';

export default function Widget() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Widget" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[type.label, { color: colors.inkMute }]}>
          A home-screen widget with today&apos;s net and calories left arrives in the next build.
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
