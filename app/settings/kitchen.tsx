// Your kitchen (spec/02 §F, §O7) — Plus. The moat: four questions, asked once,
// that no competitor can buy. Setting any of them clears is_assumed and
// recomputes today (spec/06: past days keep their calc_version). Route-guarded
// to Plus at the caller; this screen assumes access.

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { getKitchen, patchKitchen, type KitchenPatch } from '@/db/profileRepo';
import type { KitchenRow } from '@/db/rows';
import { dayKey } from '@/journal';
import { services } from '@/lib/services';
import { numberMaxFontScale, radius, screenPadding, spacing, type, useTheme } from '@/theme';

// Labelled with the millilitres, not just the size word. The engine reads a
// katori as a volume, so a user who never opens this screen is still working
// to a number — better they can see which one. "Medium" rather than
// "Standard": 200 is our default, but the word implies it is the correct
// katori rather than the middle option, and it has not earned that.
const KATORI = [
  { value: '150', label: 'Small · 150ml' },
  { value: '200', label: 'Medium · 200ml' },
  { value: '250', label: 'Large · 250ml' },
] as const;

const ROTI = [
  { value: '25', label: '6″' },
  { value: '35', label: '8″' },
  { value: '50', label: '10″' },
] as const;

const SUGAR = [
  { value: '0', label: '0' },
  { value: '1', label: '1 tsp' },
  { value: '2', label: '2 tsp' },
] as const;

const MILK = [
  { value: 'none', label: 'None' },
  { value: 'toned', label: 'Toned' },
  { value: 'full', label: 'Full-fat' },
] as const;

function Question({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.question}>
      <Text style={[type.label, { color: colors.ink }]}>{title}</Text>
      {children}
    </View>
  );
}

export default function Kitchen() {
  const { colors } = useTheme();
  const [row, setRow] = useState<KitchenRow | null>(null);

  useEffect(() => {
    let mounted = true;
    services().then(async (svc) => {
      const kitchen = await getKitchen(svc.adapter, svc.userId);
      if (mounted) setRow(kitchen);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const save = async (patch: KitchenPatch) => {
    setRow((prev) => (prev ? { ...prev, ...patch, is_assumed: 0 } : prev));
    const svc = await services();
    // Any answer means these are real values now, not population medians.
    await patchKitchen(
      svc.adapter,
      svc.userId,
      { ...patch, is_assumed: 0 },
      new Date().toISOString(),
    );
    await svc.store.recomputeToday(dayKey(new Date()));
    void svc.syncTick();
  };

  if (!row) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
        <ScreenHeader title="Your kitchen" />
      </SafeAreaView>
    );
  }

  const oilMlPerPerson =
    row.household_size > 0 && row.oil_bottle_days > 0
      ? Math.round(row.oil_bottle_ml / row.oil_bottle_days / row.household_size)
      : 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Your kitchen" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Question title="Your katori">
          <Segmented
            options={KATORI}
            value={String(row.katori_ml)}
            onChange={(v) => void save({ katori_ml: Number(v) })}
          />
        </Question>

        <Question title="Your roti">
          <Segmented
            options={ROTI}
            value={String(row.roti_g)}
            onChange={(v) => void save({ roti_g: Number(v) })}
          />
        </Question>

        <Question title="Your oil">
          <View style={styles.oilRow}>
            <Text style={[type.body, { color: colors.ink }]}>A 1L bottle lasts us about</Text>
            <TextInput
              value={String(row.oil_bottle_days)}
              onChangeText={(t) => void save({ oil_bottle_days: Math.max(1, Number(t) || 1) })}
              keyboardType="number-pad"
              accessibilityLabel="Days a bottle lasts"
              maxFontSizeMultiplier={numberMaxFontScale}
              style={[
                type.number,
                styles.miniInput,
                { backgroundColor: colors.fill, color: colors.ink },
              ]}
            />
            <Text style={[type.body, { color: colors.ink }]}>days, cooking for</Text>
            <TextInput
              value={String(row.household_size)}
              onChangeText={(t) => void save({ household_size: Math.max(1, Number(t) || 1) })}
              keyboardType="number-pad"
              accessibilityLabel="Household size"
              maxFontSizeMultiplier={numberMaxFontScale}
              style={[
                type.number,
                styles.miniInput,
                { backgroundColor: colors.fill, color: colors.ink },
              ]}
            />
            <Text style={[type.body, { color: colors.ink }]}>people.</Text>
          </View>
          <Text style={[type.caption, { color: colors.inkMute }]}>
            ≈ {oilMlPerPerson} ml per person a day
          </Text>
        </Question>

        <Question title="Chai">
          <Segmented
            options={SUGAR}
            value={String(row.chai_sugar_tsp)}
            onChange={(v) => void save({ chai_sugar_tsp: Number(v) })}
          />
          <View style={styles.gap} />
          <Segmented
            options={MILK}
            value={row.chai_milk}
            onChange={(v) => void save({ chai_milk: v })}
          />
        </Question>

        <Question title="Coffee">
          <Segmented
            options={SUGAR}
            value={String(row.coffee_sugar_tsp)}
            onChange={(v) => void save({ coffee_sugar_tsp: Number(v) })}
          />
          <View style={styles.gap} />
          <Segmented
            options={[...MILK, { value: 'decoction', label: 'Filter' }]}
            value={row.coffee_milk}
            onChange={(v) => void save({ coffee_milk: v })}
          />
        </Question>
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
    gap: spacing.lg,
  },
  question: {
    gap: spacing.sm,
  },
  oilRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  miniInput: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minWidth: 48,
    textAlign: 'center',
  },
  gap: {
    height: spacing.xs,
  },
});
