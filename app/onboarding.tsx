// Onboarding (spec/02 §A): two chapters — teach (5 screens, no input), set up
// (4 screens, one required input). Nothing is collected before the DPDP
// notice. Skips fabricate nothing. Start goes straight to the journal; the
// paywall appears once after Start and is dismissible.

import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  bmrPreview,
  cmFromFtIn,
  DEFAULT_DRAFT,
  validateGoal,
  type OnboardingDraft,
} from '@/onboarding';
import { completeOnboarding, loadDraft, saveDraft } from '@/lib/onboardingState';
import {
  primaryButtonHeight,
  radius,
  screenPadding,
  spacing,
  type,
  useTheme,
  type Theme,
} from '@/theme';

type Step = 'o0' | 'o1' | 'o2' | 'o3' | 'o4' | 'o5' | 'o6' | 'o7' | 'o8' | 'o9' | 'o10' | 'o11';

const ORDER: Step[] = ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9', 'o10', 'o11'];
const TEACH: Step[] = ['o1', 'o2', 'o3', 'o4', 'o5'];
const SETUP: Step[] = ['o6', 'o7', 'o8', 'o9'];

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------

function PrimaryButton({ label, onPress }: { label: string; onPress(): void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.primaryBtn, { backgroundColor: colors.ink }]}
    >
      <Text style={[type.body, { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress(): void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.primaryBtn, { backgroundColor: colors.fill }]}
    >
      <Text style={[type.body, { color: colors.inkMute }]}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, theme }: { label: string; theme: Theme }) {
  return (
    <View style={[styles.chip, { backgroundColor: theme.colors.fill }]}>
      <Text style={[type.body, { color: theme.colors.ink }]}>{label}</Text>
    </View>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange(next: T): void;
  format(option: T): string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.fill }]}>
      {options.map((option) => (
        <Pressable
          key={String(option)}
          onPress={() => onChange(option)}
          accessibilityRole="button"
          accessibilityState={{ selected: option === value }}
          style={[styles.segment, option === value && { backgroundColor: colors.surface }]}
        >
          <Text style={[type.label, { color: option === value ? colors.ink : colors.inkMute }]}>
            {format(option)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Two tracks: chapter one short, chapter two long (spec/03). */
function Progress({ step }: { step: Step }) {
  const { colors } = useTheme();
  const teachIndex = TEACH.indexOf(step);
  const setupIndex = SETUP.indexOf(step);
  const teachFill = teachIndex >= 0 ? (teachIndex + 1) / TEACH.length : setupIndex >= 0 ? 1 : 0;
  const setupFill = setupIndex >= 0 ? (setupIndex + 1) / SETUP.length : 0;
  if (step === 'o0' || step === 'o10' || step === 'o11') return <View style={styles.progress} />;
  return (
    <View style={[styles.progress, styles.progressRow]}>
      <View style={[styles.track, { flex: 1, backgroundColor: colors.fill }]}>
        <View style={[styles.trackFill, { flex: teachFill, backgroundColor: colors.ink }]} />
        <View style={{ flex: 1 - teachFill }} />
      </View>
      <View style={[styles.track, { flex: 3, backgroundColor: colors.fill }]}>
        <View style={[styles.trackFill, { flex: setupFill, backgroundColor: colors.ink }]} />
        <View style={{ flex: 1 - setupFill }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// the screen
// ---------------------------------------------------------------------------

export default function Onboarding() {
  const theme = useTheme();
  const { colors } = theme;
  const [step, setStep] = useState<Step>('o0');
  const [draft, setDraft] = useState<OnboardingDraft>(DEFAULT_DRAFT);
  const [goalText, setGoalText] = useState('');
  const [goalError, setGoalError] = useState<string | null>(null);
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ftin'>('cm');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');

  useEffect(() => {
    void loadDraft().then(setDraft);
  }, []);

  const update = (next: OnboardingDraft) => {
    setDraft(next);
    void saveDraft(next);
  };

  const next = () => {
    const i = ORDER.indexOf(step);
    const following = ORDER[i + 1];
    if (following) setStep(following);
  };

  const start = async () => {
    await completeOnboarding(draft);
    setStep('o11');
  };

  const finish = () => router.replace('/');

  const preview = useMemo(() => bmrPreview(draft.body), [draft.body]);

  const body = (() => {
    switch (step) {
      case 'o0':
        return (
          <>
            <Text style={[type.title, { color: colors.ink }]}>Before anything else</Text>
            <Text style={[type.body, styles.gap, { color: colors.ink }]}>
              Slate collects your age, sex, height, weight, and the food you write — to compute
              calories, and for nothing else.
            </Text>
            <Text style={[type.body, styles.gap, { color: colors.ink }]}>
              {"It's stored in India. You can export it or delete it any time from Settings."}
            </Text>
            <Text style={[type.caption, styles.gap, { color: colors.inkMute }]}>
              Full privacy policy ↗
            </Text>
            <View style={styles.spacer} />
            <PrimaryButton label="Continue" onPress={next} />
          </>
        );
      case 'o1':
        return (
          <>
            <Text style={[type.display, { color: colors.ink }]}>
              Slate uses AI to work out nutrition for you.
            </Text>
            <View style={[styles.gapXl, styles.centerCol]}>
              <Chip label="Half a bowl of poha" theme={theme} />
              <Text style={[type.body, { color: colors.inkMute }]}>↓</Text>
              <Chip label="✦ 180 calories" theme={theme} />
            </View>
            <View style={styles.spacer} />
            <PrimaryButton label="Next" onPress={next} />
          </>
        );
      case 'o2':
        return (
          <>
            <Text style={[type.display, { color: colors.ink }]}>It combines several sources.</Text>
            <View style={[styles.gapXl, styles.centerCol]}>
              <Chip label="1 katori dal" theme={theme} />
              <Text style={[type.body, { color: colors.inkMute }]}>↓</Text>
              <View style={styles.cardsRow}>
                {['IFCT 2017', 'Our recipes', 'Your kitchen'].map((source) => (
                  <View
                    key={source}
                    style={[styles.sourceCard, { backgroundColor: colors.surface }]}
                  >
                    <Text style={[type.caption, { color: colors.ink }]}>{source}</Text>
                  </View>
                ))}
              </View>
              <Text style={[type.body, { color: colors.inkMute }]}>↓</Text>
              <Chip label="140 calories ✓" theme={theme} />
            </View>
            <View style={styles.spacer} />
            <PrimaryButton label="Next" onPress={next} />
          </>
        );
      case 'o3':
        return (
          <>
            <Text style={[type.display, { color: colors.ink }]}>
              Type anything, including exercise.
            </Text>
            <View style={styles.gapXl}>
              {(
                [
                  ['2 rotis', '220 cal', false],
                  ['Chai with sugar', '110 cal', false],
                  ['5k jog', '-320 cal', true],
                  ['1 katori rajma', '180 cal', false],
                  ['Vada pav', '290 cal', false],
                  ['45 min weights', '-190 cal', true],
                  ['Masala dosa', '380 cal', false],
                ] as const
              ).map(([text, cal, negative]) => (
                <View key={text} style={styles.exampleRow}>
                  <Text style={[type.body, { color: colors.ink }]}>{text}</Text>
                  <Text style={[type.number, { color: negative ? colors.inkMute : colors.ink }]}>
                    {cal}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.spacer} />
            <PrimaryButton label="Next" onPress={next} />
          </>
        );
      case 'o4':
        return (
          <>
            <Text style={[type.display, { color: colors.ink }]}>
              Want to be precise? Add detail.
            </Text>
            <View style={[styles.gapXl, styles.centerCol]}>
              <Chip label="Poha, 60g flattened rice, 1 tsp oil, peanuts" theme={theme} />
              <Text style={[type.body, { color: colors.inkMute }]}>↓</Text>
              <Chip label="210 cal" theme={theme} />
              <Text style={[type.caption, styles.gap, { color: colors.inkMute }]}>
                Or scan a barcode or label.
              </Text>
            </View>
            <View style={styles.spacer} />
            <PrimaryButton label="Next" onPress={next} />
          </>
        );
      case 'o5':
        return (
          <>
            <Text style={[type.title, { color: colors.ink }]}>
              {"Nutrition labels are often 20% off, so don't stress over single calories."}
            </Text>
            <Text style={[type.title, styles.gapXl, { color: colors.ink }]}>
              Use good estimates and adjust based on progress.
            </Text>
            <Text style={[type.caption, styles.gap, { color: colors.inkMute }]}>
              Research sources ↗
            </Text>
            <View style={styles.spacer} />
            <PrimaryButton label="Next" onPress={next} />
          </>
        );
      case 'o6': {
        const b = draft.body;
        const setBody = (patch: Partial<typeof b>) =>
          update({ ...draft, body: { ...b, ...patch, skipped: false } });
        return (
          <>
            <Text style={[type.title, { color: colors.ink }]}>Your body</Text>
            <View style={styles.gap}>
              <Text style={[type.label, { color: colors.inkMute }]}>Age</Text>
              <TextInput
                keyboardType="number-pad"
                value={b.age === null ? '' : String(b.age)}
                onChangeText={(v) => setBody({ age: v ? Number(v) : null })}
                accessibilityLabel="Age"
                style={[
                  type.body,
                  styles.field,
                  { backgroundColor: colors.fill, color: colors.ink },
                ]}
              />
              <Text style={[type.label, styles.gap, { color: colors.inkMute }]}>Sex</Text>
              <Segmented
                options={['male', 'female'] as const}
                value={(b.sex ?? '') as 'male' | 'female'}
                onChange={(sex) => setBody({ sex })}
                format={(o) => (o === 'male' ? 'Male' : 'Female')}
              />
              <View style={styles.rowBetween}>
                <Text style={[type.label, styles.gap, { color: colors.inkMute }]}>Height</Text>
                <Segmented
                  options={['cm', 'ftin'] as const}
                  value={heightUnit}
                  onChange={(u) => setHeightUnit(u)}
                  format={(o) => (o === 'cm' ? 'cm' : 'ft-in')}
                />
              </View>
              {heightUnit === 'cm' ? (
                <TextInput
                  keyboardType="numeric"
                  value={b.heightCm === null ? '' : String(b.heightCm)}
                  onChangeText={(v) => setBody({ heightCm: v ? Number(v) : null })}
                  accessibilityLabel="Height in centimetres"
                  style={[
                    type.body,
                    styles.field,
                    { backgroundColor: colors.fill, color: colors.ink },
                  ]}
                />
              ) : (
                <View style={styles.rowGap}>
                  <TextInput
                    keyboardType="number-pad"
                    value={feet}
                    placeholder="ft"
                    placeholderTextColor={colors.inkMute}
                    onChangeText={(v) => {
                      setFeet(v);
                      const f = Number(v);
                      const i = Number(inches || '0');
                      // conversion at the input boundary; storage is always cm
                      if (Number.isFinite(f) && f > 0) setBody({ heightCm: cmFromFtIn(f, i) });
                    }}
                    accessibilityLabel="Height, feet"
                    style={[
                      type.body,
                      styles.field,
                      styles.half,
                      { backgroundColor: colors.fill, color: colors.ink },
                    ]}
                  />
                  <TextInput
                    keyboardType="number-pad"
                    value={inches}
                    placeholder="in"
                    placeholderTextColor={colors.inkMute}
                    onChangeText={(v) => {
                      setInches(v);
                      const f = Number(feet || '0');
                      const i = Number(v || '0');
                      if (Number.isFinite(f) && f > 0) setBody({ heightCm: cmFromFtIn(f, i) });
                    }}
                    accessibilityLabel="Height, inches"
                    style={[
                      type.body,
                      styles.field,
                      styles.half,
                      { backgroundColor: colors.fill, color: colors.ink },
                    ]}
                  />
                </View>
              )}
              <Text style={[type.label, styles.gap, { color: colors.inkMute }]}>Weight (kg)</Text>
              <TextInput
                keyboardType="numeric"
                value={b.weightKg === null ? '' : String(b.weightKg)}
                onChangeText={(v) => setBody({ weightKg: v ? Number(v) : null })}
                accessibilityLabel="Weight in kilograms"
                style={[
                  type.body,
                  styles.field,
                  { backgroundColor: colors.fill, color: colors.ink },
                ]}
              />
            </View>
            {preview.bmr !== null && preview.baseline !== null && (
              <View style={styles.gapXl}>
                <View style={styles.exampleRow}>
                  <Text style={[type.label, { color: colors.inkMute }]}>BMR</Text>
                  <Text style={[type.number, { color: colors.ink }]}>
                    {Math.round(preview.bmr).toLocaleString('en-IN')}
                  </Text>
                </View>
                <View style={styles.exampleRow}>
                  <Text style={[type.label, { color: colors.inkMute }]}>Sedentary baseline</Text>
                  <Text style={[type.number, { color: colors.ink }]}>
                    {Math.round(preview.baseline).toLocaleString('en-IN')}
                  </Text>
                </View>
              </View>
            )}
            <View style={styles.spacer} />
            <SecondaryButton
              label="Skip"
              onPress={() => {
                update({ ...draft, body: { ...DEFAULT_DRAFT.body, skipped: true } });
                next();
              }}
            />
            <PrimaryButton label="Next" onPress={next} />
          </>
        );
      }
      case 'o7': {
        const k = draft.kitchen;
        const setKitchen = (patch: Partial<typeof k>) =>
          update({ ...draft, kitchen: { ...k, ...patch, skipped: false } });
        return (
          <>
            <Text style={[type.title, { color: colors.ink }]}>Your kitchen</Text>
            <Text style={[type.label, styles.gap, { color: colors.inkMute }]}>Your katori</Text>
            <Segmented
              options={[150, 200, 250] as const}
              value={k.katoriMl}
              onChange={(katoriMl) => setKitchen({ katoriMl })}
              format={(o) =>
                o === 150 ? 'Small · 150ml' : o === 200 ? 'Standard · 200ml' : 'Large · 250ml'
              }
            />
            <Text style={[type.label, styles.gap, { color: colors.inkMute }]}>Your roti</Text>
            <Segmented
              options={[25, 35, 50] as const}
              value={k.rotiG}
              onChange={(rotiG) => setKitchen({ rotiG })}
              format={(o) => (o === 25 ? 'Small · 6″' : o === 35 ? 'Medium · 8″' : 'Large · 10″')}
            />
            <Text style={[type.label, styles.gap, { color: colors.inkMute }]}>Your oil</Text>
            <View style={styles.oilRow}>
              <Text style={[type.body, { color: colors.ink }]}>A 1L bottle lasts us about</Text>
              <TextInput
                keyboardType="number-pad"
                value={String(k.oilBottleDays)}
                onChangeText={(v) => setKitchen({ oilBottleDays: Number(v) || 30 })}
                accessibilityLabel="Days a 1 litre oil bottle lasts"
                style={[
                  type.number,
                  styles.inlineField,
                  { backgroundColor: colors.fill, color: colors.ink },
                ]}
              />
              <Text style={[type.body, { color: colors.ink }]}>days, cooking for</Text>
              <TextInput
                keyboardType="number-pad"
                value={String(k.householdSize)}
                onChangeText={(v) => setKitchen({ householdSize: Number(v) || 4 })}
                accessibilityLabel="People cooked for"
                style={[
                  type.number,
                  styles.inlineField,
                  { backgroundColor: colors.fill, color: colors.ink },
                ]}
              />
              <Text style={[type.body, { color: colors.ink }]}>people.</Text>
            </View>
            <Text style={[type.label, styles.gap, { color: colors.inkMute }]}>
              Chai & coffee — sugar
            </Text>
            <Segmented
              options={[0, 1, 2] as const}
              value={k.chaiSugarTsp}
              onChange={(chaiSugarTsp) => setKitchen({ chaiSugarTsp })}
              format={(o) => `${o} tsp`}
            />
            <Text style={[type.label, styles.gap, { color: colors.inkMute }]}>Milk</Text>
            <Segmented
              options={['none', 'toned', 'full', 'decoction'] as const}
              value={k.chaiMilk}
              onChange={(chaiMilk) => setKitchen({ chaiMilk })}
              format={(o) =>
                o === 'none'
                  ? 'None'
                  : o === 'toned'
                    ? 'Toned'
                    : o === 'full'
                      ? 'Full-fat'
                      : 'Filter coffee'
              }
            />
            <View style={styles.spacer} />
            <SecondaryButton
              label="Skip"
              onPress={() => {
                update({ ...draft, kitchen: { ...DEFAULT_DRAFT.kitchen, skipped: true } });
                next();
              }}
            />
            <PrimaryButton label="Next" onPress={next} />
          </>
        );
      }
      case 'o8':
        return (
          <>
            <Text style={[type.title, { color: colors.ink }]}>Your goal</Text>
            <View style={[styles.gapXl, styles.goalRow]}>
              <TextInput
                keyboardType="number-pad"
                value={goalText}
                onChangeText={(v) => {
                  setGoalText(v);
                  const { goal, error } = validateGoal(v);
                  setGoalError(error);
                  update({ ...draft, calorieGoal: goal });
                }}
                accessibilityLabel="Calorie goal"
                style={[type.heroNumber, styles.goalField, { color: colors.ink }]}
              />
              <Text style={[type.label, { color: colors.inkMute }]}>cals</Text>
            </View>
            {goalError && (
              <Text style={[type.caption, styles.gap, { color: colors.ink }]}>{goalError}</Text>
            )}
            <View style={styles.gapXl}>
              {preview.bmr !== null && preview.baseline !== null ? (
                <>
                  <Text style={[type.caption, { color: colors.inkMute }]}>
                    BMR {Math.round(preview.bmr).toLocaleString('en-IN')}
                  </Text>
                  <Text style={[type.caption, { color: colors.inkMute }]}>
                    Sedentary baseline {Math.round(preview.baseline).toLocaleString('en-IN')}
                  </Text>
                </>
              ) : (
                <Text style={[type.caption, { color: colors.inkMute }]}>
                  Set up your body to see your baseline →
                </Text>
              )}
            </View>
            <View style={styles.spacer} />
            <PrimaryButton label="Next" onPress={next} />
          </>
        );
      case 'o9':
        return (
          <>
            <Text style={[type.title, { color: colors.ink }]}>
              Want Slate to remind you to journal?
            </Text>
            <View style={styles.spacer} />
            <SecondaryButton
              label="No thanks"
              onPress={() => {
                update({ ...draft, remindersEnabled: false });
                next();
              }}
            />
            <PrimaryButton
              label="Enable reminders"
              onPress={() => {
                update({ ...draft, remindersEnabled: true });
                void Notifications.requestPermissionsAsync();
                next();
              }}
            />
          </>
        );
      case 'o10':
        return (
          <>
            <Text style={[type.display, { color: colors.ink }]}>Enjoy.</Text>
            <Text style={[type.body, styles.gap, { color: colors.inkMute }]}>
              Slate fits your life, whether you journal daily or once in a while.
            </Text>
            <View style={[styles.gapXl, styles.dotsRow]}>
              {[1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((filled, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    filled
                      ? { backgroundColor: colors.ink }
                      : { borderWidth: 1, borderColor: colors.inkMute },
                  ]}
                />
              ))}
            </View>
            <View style={styles.spacer} />
            <PrimaryButton label="Start" onPress={() => void start()} />
          </>
        );
      case 'o11':
        return (
          <>
            <Text style={[type.title, { color: colors.ink }]}>Slate Plus</Text>
            <View style={[styles.gapXl, styles.columns]}>
              <View style={styles.column}>
                <Text style={[type.label, { color: colors.inkMute }]}>Free</Text>
                {[
                  'unlimited entries',
                  'barcode',
                  'label',
                  'macros',
                  'weight',
                  'exercise',
                  'streak',
                  'hide calories',
                  'export',
                  '30-day history',
                ].map((f) => (
                  <Text key={f} style={[type.caption, styles.feature, { color: colors.ink }]}>
                    {f}
                  </Text>
                ))}
              </View>
              <View style={styles.column}>
                <Text style={[type.label, { color: colors.inkMute }]}>Plus</Text>
                {[
                  'stats',
                  'fiber & sugar',
                  'kitchen calibration',
                  'saved foods',
                  'widgets',
                  'photo logging',
                  'chat',
                  'Apple Health',
                  'full history',
                  'custom dishes',
                ].map((f) => (
                  <Text key={f} style={[type.caption, styles.feature, { color: colors.ink }]}>
                    {f}
                  </Text>
                ))}
              </View>
            </View>
            <Text style={[type.body, styles.gapXl, { color: colors.ink }]}>
              Monthly ₹199 · Yearly ₹1,499 <Text style={{ color: colors.inkMute }}>(-37%)</Text>
            </Text>
            <View style={styles.spacer} />
            {/* Purchase wiring is Phase 5 (RevenueCat); the button exists, the sheet is honest */}
            <SecondaryButton label="No thanks" onPress={finish} />
            <PrimaryButton label="Upgrade" onPress={finish} />
          </>
        );
    }
  })();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Progress step={step} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  progress: { height: 28, justifyContent: 'center', paddingHorizontal: screenPadding },
  progressRow: { flexDirection: 'row', gap: spacing.sm },
  track: { height: 4, borderRadius: 2, flexDirection: 'row', overflow: 'hidden' },
  trackFill: { borderRadius: 2 },
  content: { flexGrow: 1, padding: screenPadding, paddingBottom: spacing.xl },
  gap: { marginTop: spacing.md },
  gapXl: { marginTop: spacing.xl },
  rowGap: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  spacer: { flexGrow: 1, minHeight: spacing.xl },
  centerCol: { alignItems: 'center', gap: spacing.md },
  cardsRow: { flexDirection: 'row', gap: spacing.sm },
  sourceCard: {
    borderRadius: radius.card / 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chip: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  exampleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  primaryBtn: {
    height: primaryButtonHeight,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.chip,
    padding: 3,
    marginTop: spacing.xs,
  },
  segment: {
    flex: 1,
    borderRadius: radius.chip,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  field: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  inlineField: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minWidth: 56,
    textAlign: 'center',
  },
  oilRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  goalRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  goalField: { minWidth: 160, borderBottomWidth: 1, paddingVertical: spacing.xs },
  dotsRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  columns: { flexDirection: 'row', gap: spacing.lg },
  column: { flex: 1, gap: spacing.xs },
  feature: { marginTop: spacing.xs },
});
