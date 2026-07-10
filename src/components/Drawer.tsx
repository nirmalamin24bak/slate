// The drawer (spec/02 §C). A quiet list, not a navigation hub: Journal, Chat
// (Plus), then History / Streak / Stats / Settings, and a share line at the
// bottom. Slides over the journal from the `=` button.

import { useRouter, type Href } from 'expo-router';
import { Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePlus } from '@/lib/plus';
import { screenPadding, spacing, type, useTheme } from '@/theme';

import { PlusBadge } from './PlusBadge';

// FLAG(nirmal): share copy + App Store link — final URL doesn't exist until
// the listing does. Plain sentence, no marketing voice, per brand/BRAND-VOICE.
const SHARE_MESSAGE = 'Slate. A calorie journal you type into. https://slate.app';

interface DrawerProps {
  visible: boolean;
  onClose(): void;
}

interface DrawerRow {
  label: string;
  plus?: boolean;
  route?: string;
}

const TOP_ROWS: readonly DrawerRow[] = [
  { label: 'Journal' },
  { label: 'Chat', plus: true, route: '/chat' },
];

const MAIN_ROWS: readonly DrawerRow[] = [
  { label: 'History', route: '/history' },
  { label: 'Streak', route: '/streak' },
  { label: 'Stats', plus: true, route: '/stats' },
  { label: 'Settings', route: '/settings' },
];

export function Drawer({ visible, onClose }: DrawerProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const plus = usePlus();

  const open = (row: DrawerRow) => {
    onClose();
    if (!row.route) return; // Journal — we're already there
    // Chat has no free preview → paywall. Stats has a free "trends" row and
    // self-guards, so it opens for everyone; the gate is inside the screen.
    const target = row.label === 'Chat' && row.plus && !plus ? '/paywall' : row.route;
    router.push(target as Href);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrimWrap}>
        <Pressable
          accessibilityLabel="Close menu"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.scrim]}
        />
        <SafeAreaView style={[styles.panel, { backgroundColor: colors.surface }]}>
          <View style={styles.rows}>
            {TOP_ROWS.map((row) => (
              <Pressable
                key={row.label}
                accessibilityRole="button"
                onPress={() => open(row)}
                style={styles.row}
              >
                <Text style={[type.body, { color: colors.ink }]}>{row.label}</Text>
                {row.plus && !plus && <PlusBadge />}
              </Pressable>
            ))}
            <View style={[styles.divider, { backgroundColor: colors.hairline }]} />
            {MAIN_ROWS.map((row) => (
              <Pressable
                key={row.label}
                accessibilityRole="button"
                onPress={() => open(row)}
                style={styles.row}
              >
                <Text style={[type.body, { color: colors.ink }]}>{row.label}</Text>
                {row.plus && !plus && <PlusBadge />}
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              void Share.share({ message: SHARE_MESSAGE });
            }}
            style={styles.share}
          >
            <Text style={[type.label, { color: colors.inkMute }]}>Share Slate with friends</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrimWrap: {
    flex: 1,
    flexDirection: 'row',
  },
  scrim: {
    backgroundColor: 'rgba(17, 18, 20, 0.35)',
  },
  panel: {
    width: '72%',
    maxWidth: 320,
    justifyContent: 'space-between',
  },
  rows: {
    paddingTop: spacing.xl,
    paddingHorizontal: screenPadding,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.sm,
  },
  share: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.lg,
  },
});
