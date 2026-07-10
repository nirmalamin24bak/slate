// Delete my data (spec/08 §2). In-app, two taps and a confirm — not an email,
// not a support ticket. Hard delete, cascades in Supabase. The confirm names
// the one thing that survives: the Apple subscription, which lives with the
// Apple ID we don't own.

import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { deleteAccount, DeleteFailed } from '@/lib/deleteAccount';
import { services } from '@/lib/services';
import { screenPadding, spacing, type, useTheme } from '@/theme';

export default function DeleteData() {
  const { colors } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const svc = await services();
      await deleteAccount(svc.adapter);
      // Nothing to route back to — restart at onboarding as a fresh device.
      router.replace('/onboarding');
    } catch (e) {
      setError(
        e instanceof DeleteFailed
          ? "Couldn't reach Slate to delete your data. Nothing was removed. Try again."
          : 'Something went wrong. Nothing was removed.',
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Delete my data" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[type.body, { color: colors.ink }]}>
          This permanently deletes your profile, kitchen, every entry, and every weight. It
          can&apos;t be undone.
        </Text>
        <Text style={[type.label, styles.note, { color: colors.inkMute }]}>
          A Slate Plus subscription stays with your Apple ID and isn&apos;t deleted here — manage it
          in the App Store.
        </Text>

        {error && <Text style={[type.label, styles.error, { color: colors.ink }]}>{error}</Text>}

        <SafeAreaView edges={['bottom']} style={styles.actions}>
          {confirming ? (
            <>
              <SecondaryButton label="Keep my data" onPress={() => setConfirming(false)} />
              <PrimaryButton
                label={busy ? 'Deleting…' : 'Delete everything'}
                onPress={() => void run()}
                disabled={busy}
              />
            </>
          ) : (
            <PrimaryButton label="Delete my data" onPress={() => setConfirming(true)} />
          )}
        </SafeAreaView>
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
    gap: spacing.md,
  },
  note: {
    marginTop: spacing.sm,
  },
  error: {
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
});
