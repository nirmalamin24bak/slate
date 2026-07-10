// Bottom sheet scaffold — platform slide (spec/03 motion #3 is the standard
// sheet spring; RN Modal's slide is the platform default we get for free).

import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { radius, screenPadding, spacing, useTheme } from '@/theme';

export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose(): void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <View style={[styles.handle, { backgroundColor: colors.fill }]} />
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 18, 20, 0.3)',
  },
  sheet: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
});
