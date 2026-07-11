// Calorie goal (spec/02 §F). An empty field the user fills. No suggestion, no
// "we recommend" — instruments, not instructions. Below 1,200 it shows one
// plain sentence and doesn't accept the number (spec/09 goal floor).

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { getProfile, patchProfile } from '@/db/profileRepo';
import { baseline, bmr, isValidGoal } from '@/engine';
import { services } from '@/lib/services';
import { GOAL_REJECTION_MESSAGE } from '@/onboarding';
import {
  numberMaxFontScale,
  numberProps,
  radius,
  screenPadding,
  spacing,
  type,
  useTheme,
} from '@/theme';

function ageFromDob(dob: string | null, now: Date): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  if (!y) return null;
  const birthday = new Date(y, (m ?? 1) - 1, d ?? 1);
  let age = now.getFullYear() - birthday.getFullYear();
  const passed =
    now.getMonth() > birthday.getMonth() ||
    (now.getMonth() === birthday.getMonth() && now.getDate() >= birthday.getDate());
  if (!passed) age -= 1;
  return age;
}

export default function CalorieGoal() {
  const { colors } = useTheme();
  const [value, setValue] = useState('');
  const [rejected, setRejected] = useState(false);
  const [numbers, setNumbers] = useState<{ bmr: number; baseline: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    services().then(async (svc) => {
      const profile = await getProfile(svc.adapter, svc.userId);
      if (!mounted || !profile) return;
      if (profile.calorie_goal != null) setValue(String(profile.calorie_goal));
      const bmrKcal = bmr({
        sex: profile.sex === 'male' || profile.sex === 'female' ? profile.sex : null,
        weightKg: profile.weight_is_assumed === 1 ? null : profile.weight_kg,
        heightCm: profile.height_cm,
        age: ageFromDob(profile.dob, new Date()),
      });
      const base = baseline(bmrKcal);
      if (bmrKcal !== null && base !== null) {
        setNumbers({ bmr: Math.round(bmrKcal), baseline: Math.round(base) });
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const save = async (text: string) => {
    setValue(text);
    const trimmed = text.trim();
    const svc = await services();
    const nowIso = new Date().toISOString();
    if (trimmed.length === 0) {
      setRejected(false);
      await patchProfile(svc.adapter, svc.userId, { calorie_goal: null }, nowIso);
      void svc.syncTick();
      return;
    }
    const goal = Number(trimmed);
    if (!isValidGoal(goal)) {
      setRejected(true);
      return; // it simply doesn't accept the number
    }
    setRejected(false);
    await patchProfile(svc.adapter, svc.userId, { calorie_goal: Math.round(goal) }, nowIso);
    void svc.syncTick();
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Calorie goal" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.field, { backgroundColor: colors.fill }]}>
          <TextInput
            value={value}
            onChangeText={(t) => void save(t)}
            keyboardType="number-pad"
            placeholder=""
            placeholderTextColor={colors.inkMute}
            accessibilityLabel="Calorie goal"
            maxFontSizeMultiplier={numberMaxFontScale}
            style={[type.heroNumber, styles.input, { color: colors.ink }]}
          />
          <Text style={[type.label, { color: colors.inkMute }]}>cals</Text>
        </View>

        {rejected && (
          <Text style={[type.label, styles.note, { color: colors.ink }]}>
            {GOAL_REJECTION_MESSAGE}
          </Text>
        )}

        {numbers && (
          <View style={styles.numbers}>
            <View style={styles.numberRow}>
              <Text style={[type.caption, { color: colors.inkMute }]}>BMR</Text>
              <Text {...numberProps} style={[type.number, { color: colors.inkMute }]}>
                {numbers.bmr.toLocaleString('en-IN')}
              </Text>
            </View>
            <View style={styles.numberRow}>
              <Text style={[type.caption, { color: colors.inkMute }]}>Sedentary baseline</Text>
              <Text {...numberProps} style={[type.number, { color: colors.inkMute }]}>
                {numbers.baseline.toLocaleString('en-IN')}
              </Text>
            </View>
          </View>
        )}
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
  field: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  note: {
    marginTop: spacing.md,
  },
  numbers: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  numberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
