// Sub-screen chrome: one circular back button, then the title in the same
// position "Today" holds on the journal. Quiet, like everything else.

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { iconButtonSize, radius, screenPadding, spacing, type, useTheme } from '@/theme';

export function ScreenHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View>
      <View style={styles.chrome}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: colors.fill }]}
        >
          <Text style={[type.body, { color: colors.ink }]}>‹</Text>
        </Pressable>
      </View>
      <Text style={[type.title, styles.title, { color: colors.ink }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: {
    flexDirection: 'row',
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
  },
  iconBtn: {
    width: iconButtonSize,
    height: iconButtonSize,
    borderRadius: radius.iconBtn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
});
