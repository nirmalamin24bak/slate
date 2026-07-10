// Chat (spec/02 §C drawer, Plus). The one consumer of the sleep intent. Not
// built yet — the drawer only reaches this route when Plus is active (free
// taps route to the paywall). FLAG(nirmal): Chat is unspecified beyond "Plus";
// spec/06 warns that if Chat ships without consuming sleep, the sleep intent
// should be cut. Placeholder until its own spec exists.

import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { screenPadding, spacing, type, useTheme } from '@/theme';

export default function Chat() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Chat" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[type.label, { color: colors.inkMute }]}>
          Chat about your day is coming soon.
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
