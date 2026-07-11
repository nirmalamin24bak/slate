// Personalization (spec/02 §F, spec/05). A free-text box injected into the
// nutrition engine at calculation time — bounded: it shifts cooking
// assumptions ±30% on fat, ±20% on total, and cannot override the dish table.
// The bound lives in the engine (a Math.min), not in this copy. The
// chat-profile fields appear only with Plus; a free user sees just this box.

import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { getProfile, patchProfile } from '@/db/profileRepo';
import { dayKey } from '@/journal';
import { services } from '@/lib/services';
import { radius, screenPadding, spacing, type, useTheme } from '@/theme';

export default function Personalization() {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    let mounted = true;
    services().then(async (svc) => {
      const profile = await getProfile(svc.adapter, svc.userId);
      if (!mounted) return;
      setText(profile?.personalization ?? '');
      loaded.current = true;
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Save on blur, then recompute today so the new assumptions land immediately.
  const save = async () => {
    if (!loaded.current) return;
    const svc = await services();
    const value = text.trim();
    await patchProfile(
      svc.adapter,
      svc.userId,
      { personalization: value.length > 0 ? value : null },
      new Date().toISOString(),
    );
    await svc.store.recomputeToday(dayKey(new Date()));
    void svc.syncTick();
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Personalization" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInput
          value={text}
          onChangeText={setText}
          onBlur={() => void save()}
          multiline
          textAlignVertical="top"
          placeholder="I always cook with very little oil…"
          placeholderTextColor={colors.inkMute}
          accessibilityLabel="Personalization notes"
          style={[type.body, styles.box, { backgroundColor: colors.fill, color: colors.ink }]}
        />
        <Text style={[type.caption, styles.note, { color: colors.inkMute }]}>
          Slate uses this to adjust its estimates. It nudges cooking assumptions — it can&apos;t
          override the numbers behind a dish.
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
    paddingBottom: spacing.xl,
  },
  box: {
    minHeight: 140,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  note: {
    marginTop: spacing.md,
  },
});
