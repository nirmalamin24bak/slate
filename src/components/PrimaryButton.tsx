// Primary / secondary buttons (spec/03 Components). Full-width, ink fill, bg
// text, 56 tall, pill radius. One primary per screen; the secondary sits
// directly above it. Same shape everywhere so the app reads as one surface.

import { Pressable, StyleSheet, Text } from 'react-native';

import { primaryButtonHeight, radius, type, useTheme } from '@/theme';

interface ButtonProps {
  label: string;
  onPress(): void;
  disabled?: boolean;
}

export function PrimaryButton({ label, onPress, disabled }: ButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { backgroundColor: colors.ink, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={[type.body, { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, disabled }: ButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { backgroundColor: colors.fill }]}
    >
      <Text style={[type.body, { color: colors.inkMute }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: primaryButtonHeight,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
