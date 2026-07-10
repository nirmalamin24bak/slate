// Your body / BMR (spec/02 §F, mirrors O6). Canonical storage is cm and kg;
// the ft-in toggle converts at the input boundary and nowhere else. Under 18:
// no BMR, no numbers (spec/08 Children). Weight saves through the store so
// today's burns recompute.

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { getProfile, patchProfile } from '@/db/profileRepo';
import { baseline, bmr } from '@/engine';
import { dayKey } from '@/journal';
import { dobFromAge } from '@/onboarding';
import { services } from '@/lib/services';
import { radius, screenPadding, spacing, type, useTheme } from '@/theme';

const CM_PER_INCH = 2.54;

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

type Sex = 'male' | 'female';
type HeightUnit = 'cm' | 'ftin';

export default function Body() {
  const { colors } = useTheme();
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [unit, setUnit] = useState<HeightUnit>('cm');
  const [cm, setCm] = useState('');
  const [ft, setFt] = useState('');
  const [inch, setInch] = useState('');
  const [kg, setKg] = useState('');
  const [weightAssumed, setWeightAssumed] = useState(true);

  useEffect(() => {
    let mounted = true;
    services().then(async (svc) => {
      const profile = await getProfile(svc.adapter, svc.userId);
      if (!mounted || !profile) return;
      const years = ageFromDob(profile.dob, new Date());
      if (years !== null) setAge(String(years));
      if (profile.sex === 'male' || profile.sex === 'female') setSex(profile.sex);
      if (profile.height_cm != null) {
        setCm(String(Math.round(profile.height_cm)));
        const totalIn = profile.height_cm / CM_PER_INCH;
        setFt(String(Math.floor(totalIn / 12)));
        setInch(String(Math.round(totalIn % 12)));
      }
      if (profile.unit_height === 'ftin') setUnit('ftin');
      setWeightAssumed(profile.weight_is_assumed === 1);
      if (profile.weight_kg != null && profile.weight_is_assumed === 0) {
        setKg(String(profile.weight_kg));
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const heightCm = (): number | null => {
    if (unit === 'cm') {
      const v = Number(cm);
      return Number.isFinite(v) && v >= 90 && v <= 250 ? v : null;
    }
    const f = Number(ft);
    const i = inch.trim().length > 0 ? Number(inch) : 0;
    if (!Number.isFinite(f) || !Number.isFinite(i) || f <= 0) return null;
    const v = (f * 12 + i) * CM_PER_INCH;
    return v >= 90 && v <= 250 ? v : null;
  };

  const ageYears = (() => {
    const v = Number(age);
    return age.trim().length > 0 && Number.isFinite(v) && v > 0 && v < 120 ? v : null;
  })();
  const weightKg = (() => {
    const v = Number(kg);
    return kg.trim().length > 0 && Number.isFinite(v) && v >= 30 && v <= 250 ? v : null;
  })();

  const under18 = ageYears !== null && ageYears < 18;

  const persist = async () => {
    const svc = await services();
    const nowIso = new Date().toISOString();
    await patchProfile(
      svc.adapter,
      svc.userId,
      {
        dob: ageYears !== null ? dobFromAge(ageYears, new Date()) : null,
        sex,
        height_cm: heightCm(),
        unit_height: unit,
      },
      nowIso,
    );
    if (weightKg !== null) {
      // Through the store: writes the weight row, clears is_assumed, and
      // recomputes today's burns.
      await svc.store.provideBodyWeight(weightKg, dayKey(new Date()));
      setWeightAssumed(false);
    }
    void svc.syncTick();
  };

  const bmrKcal = under18
    ? null
    : bmr({
        sex,
        weightKg: weightAssumed && weightKg === null ? null : weightKg,
        heightCm: heightCm(),
        age: ageYears,
      });
  const base = baseline(bmrKcal);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Your body" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.row}>
          <Text style={[type.body, { color: colors.ink }]}>Age</Text>
          <TextInput
            value={age}
            onChangeText={setAge}
            onEndEditing={() => void persist()}
            keyboardType="number-pad"
            accessibilityLabel="Age in years"
            style={[type.number, styles.well, { backgroundColor: colors.fill, color: colors.ink }]}
          />
        </View>

        <View style={styles.row}>
          <Text style={[type.body, { color: colors.ink }]}>Sex</Text>
          <View style={styles.segmentWrap}>
            <Segmented
              options={[
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
              ]}
              value={sex ?? ('' as Sex)}
              onChange={(v) => {
                setSex(v);
                setTimeout(() => void persist(), 0);
              }}
            />
          </View>
        </View>

        <View style={styles.row}>
          <Text style={[type.body, { color: colors.ink }]}>Height</Text>
          <View style={styles.heightGroup}>
            {unit === 'cm' ? (
              <TextInput
                value={cm}
                onChangeText={setCm}
                onEndEditing={() => void persist()}
                keyboardType="number-pad"
                accessibilityLabel="Height in centimetres"
                style={[
                  type.number,
                  styles.well,
                  { backgroundColor: colors.fill, color: colors.ink },
                ]}
              />
            ) : (
              <>
                <TextInput
                  value={ft}
                  onChangeText={setFt}
                  onEndEditing={() => void persist()}
                  keyboardType="number-pad"
                  accessibilityLabel="Height, feet"
                  style={[
                    type.number,
                    styles.well,
                    { backgroundColor: colors.fill, color: colors.ink },
                  ]}
                />
                <TextInput
                  value={inch}
                  onChangeText={setInch}
                  onEndEditing={() => void persist()}
                  keyboardType="number-pad"
                  accessibilityLabel="Height, inches"
                  style={[
                    type.number,
                    styles.well,
                    { backgroundColor: colors.fill, color: colors.ink },
                  ]}
                />
              </>
            )}
            <View style={styles.segmentWrap}>
              <Segmented
                options={[
                  { value: 'cm', label: 'cm' },
                  { value: 'ftin', label: 'ft-in' },
                ]}
                value={unit}
                onChange={(v) => {
                  setUnit(v);
                  setTimeout(() => void persist(), 0);
                }}
              />
            </View>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={[type.body, { color: colors.ink }]}>Weight</Text>
          <View style={styles.heightGroup}>
            <TextInput
              value={kg}
              onChangeText={setKg}
              onEndEditing={() => void persist()}
              keyboardType="decimal-pad"
              placeholder={weightAssumed ? '_' : undefined}
              placeholderTextColor={colors.inkMute}
              accessibilityLabel="Weight in kilograms"
              style={[
                type.number,
                styles.well,
                { backgroundColor: colors.fill, color: colors.ink },
              ]}
            />
            <Text style={[type.label, { color: colors.inkMute }]}>kg</Text>
          </View>
        </View>

        {under18 && (
          <Text style={[type.label, styles.numbers, { color: colors.inkMute }]}>
            Slate isn&apos;t built for under-18s, so it won&apos;t show body numbers.
          </Text>
        )}

        {bmrKcal !== null && base !== null && (
          <View style={styles.numbers}>
            <View style={styles.numberRow}>
              <Text style={[type.caption, { color: colors.inkMute }]}>BMR</Text>
              <Text style={[type.number, { color: colors.ink }]}>
                {Math.round(bmrKcal).toLocaleString('en-IN')}
              </Text>
            </View>
            <View style={styles.numberRow}>
              <Text style={[type.caption, { color: colors.inkMute }]}>Sedentary baseline</Text>
              <Text style={[type.number, { color: colors.ink }]}>
                {Math.round(base).toLocaleString('en-IN')}
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
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  well: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 72,
    textAlign: 'right',
  },
  segmentWrap: {
    minWidth: 140,
  },
  heightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  numbers: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  numberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
