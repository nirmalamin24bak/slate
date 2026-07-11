// Settings (spec/02 §F). No Log out — there is nothing to log out of.
// Delete my data is a DPDP obligation, not a feature.

import { useRouter, type Href } from 'expo-router';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListRow } from '@/components/ListRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { usePlus } from '@/lib/plus';
import { accent, radius, screenPadding, spacing, type, useTheme } from '@/theme';

// FLAG(nirmal): spec/07 calls this row green; spec/03 reserves the single
// accent (indigo) and the palette has no green. Accent used — one word flips.
const SHARE_MESSAGE = 'Slate. A calorie journal you type into. https://slate.app';
const PRIVACY_URL = 'https://slate.app/privacy'; // FLAG(nirmal): final URL
const SUPPORT_EMAIL = 'support@slate.app';

export default function Settings() {
  const { colors } = useTheme();
  const router = useRouter();
  const plus = usePlus();

  const push = (route: string) => router.push(route as Href);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!plus && (
          <Pressable
            accessibilityRole="button"
            onPress={() => push('/paywall')}
            style={styles.upgrade}
          >
            <Text style={[type.body, styles.upgradeText]}>Upgrade to Slate Plus</Text>
          </Pressable>
        )}

        <ListRow
          label="Share the app"
          onPress={() => void Share.share({ message: SHARE_MESSAGE })}
        />
        <ListRow label="Your info & goals" onPress={() => push('/settings/info-goals')} />
        <ListRow
          label="Your kitchen"
          plus={!plus}
          onPress={() => push(plus ? '/settings/kitchen' : '/paywall')}
        />
        <ListRow
          label="Widget"
          plus={!plus}
          onPress={() => push(plus ? '/settings/widget' : '/paywall')}
        />
        <ListRow label="Dark mode" onPress={() => push('/settings/appearance')} />
        <ListRow
          label="Send feedback"
          onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Slate%20feedback`)}
        />

        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}>
              <Text style={[type.label, { color: colors.inkMute }]}>Privacy & terms</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => push('/settings/delete')}>
              <Text style={[type.label, { color: colors.inkMute }]}>Delete my data</Text>
            </Pressable>
          </View>
          <Text style={[type.caption, { color: colors.inkMute }]}>{SUPPORT_EMAIL}</Text>
        </View>
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
  upgrade: {
    backgroundColor: accent,
    borderRadius: radius.card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  upgradeText: {
    color: '#FFFFFF',
  },
  footer: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
