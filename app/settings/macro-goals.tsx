// Macro goals (spec/02 §F). Three optional gram targets. Same posture as the
// calorie goal: empty fields, no recommendation.

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { getProfile, patchProfile, type ProfilePatch } from '@/db/profileRepo';
import { services } from '@/lib/services';
import { numberMaxFontScale, radius, screenPadding, spacing, type, useTheme } from '@/theme';

type MacroKey = 'protein_goal_g' | 'carbs_goal_g' | 'fat_goal_g';

const FIELDS: readonly { key: MacroKey; label: string }[] = [
  { key: 'protein_goal_g', label: 'Protein' },
  { key: 'carbs_goal_g', label: 'Carbs' },
  { key: 'fat_goal_g', label: 'Fat' },
];

export default function MacroGoals() {
  const { colors } = useTheme();
  const [values, setValues] = useState<Record<MacroKey, string>>({
    protein_goal_g: '',
    carbs_goal_g: '',
    fat_goal_g: '',
  });

  useEffect(() => {
    let mounted = true;
    services().then(async (svc) => {
      const profile = await getProfile(svc.adapter, svc.userId);
      if (!mounted || !profile) return;
      setValues({
        protein_goal_g: profile.protein_goal_g != null ? String(profile.protein_goal_g) : '',
        carbs_goal_g: profile.carbs_goal_g != null ? String(profile.carbs_goal_g) : '',
        fat_goal_g: profile.fat_goal_g != null ? String(profile.fat_goal_g) : '',
      });
    });
    return () => {
      mounted = false;
    };
  }, []);

  const save = async (key: MacroKey, text: string) => {
    setValues((v) => ({ ...v, [key]: text }));
    const n = Number(text.trim());
    const patch: ProfilePatch = {
      [key]: text.trim().length > 0 && Number.isFinite(n) && n > 0 ? Math.round(n) : null,
    };
    const svc = await services();
    await patchProfile(svc.adapter, svc.userId, patch, new Date().toISOString());
    void svc.syncTick();
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Macro goals" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {FIELDS.map((field) => (
          <View key={field.key} style={styles.row}>
            <Text style={[type.body, { color: colors.ink }]}>{field.label}</Text>
            <View style={[styles.well, { backgroundColor: colors.fill }]}>
              <TextInput
                value={values[field.key]}
                onChangeText={(t) => void save(field.key, t)}
                keyboardType="number-pad"
                accessibilityLabel={`${field.label} goal in grams`}
                maxFontSizeMultiplier={numberMaxFontScale}
                style={[type.number, styles.input, { color: colors.ink }]}
              />
              <Text style={[type.caption, { color: colors.inkMute }]}>g</Text>
            </View>
          </View>
        ))}
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
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minWidth: 96,
  },
  input: {
    minWidth: 48,
    textAlign: 'right',
    paddingVertical: spacing.xs,
  },
});
