// The journal (spec/02 §B) — the only screen that matters. A multiline text
// editor: type a line, hit return, a shimmer runs, a number lands, the cursor
// is already on the next line. No submit button. No confirmation. No modal.

import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as Network from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DayScrubber } from '@/components/DayScrubber';
import { DetailSheet } from '@/components/DetailSheet';
import { Drawer } from '@/components/Drawer';
import { JournalLine } from '@/components/JournalLine';
import { OptionsSheet } from '@/components/OptionsSheet';
import { SuggestionStrip, type Suggestion } from '@/components/SuggestionStrip';
import { SummaryCard } from '@/components/SummaryCard';
import { listRecents, listSavedFoods } from '@/db/entriesRepo';
import { getProfile } from '@/db/profileRepo';
import type { ProfileRow } from '@/db/rows';
import { dayKey, type DayLine, type DayView } from '@/journal';
import { useOnboardingGate } from '@/lib/onboardingState';
import { BOUNDS, parseBounded } from '@/lib/parseNumeric';
import { takePendingLine } from '@/lib/pendingLine';
import { reportError } from '@/lib/report';
import { services, type Services } from '@/lib/services';
import { nextSyncDelay } from '@/lib/syncSchedule';
import {
  iconButtonSize,
  numberMaxFontScale,
  numberProps,
  radius,
  screenPadding,
  spacing,
  type,
  useTheme,
} from '@/theme';

interface WeightConfirm {
  entryId: string;
  newKg: number;
  prevKg: number;
}

export default function Journal() {
  const { colors } = useTheme();
  const gate = useOnboardingGate();
  const router = useRouter();
  // History and the scrubber's "View all history" land here with ?day=.
  const params = useLocalSearchParams<{ day?: string }>();

  const [svc, setSvc] = useState<Services | null>(null);
  const [today, setToday] = useState(() => dayKey(new Date()));
  const [selectedDay, setSelectedDay] = useState(today);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<DayView | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [input, setInput] = useState('');
  const [scrubbing, setScrubbing] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [detail, setDetail] = useState<DayLine | null>(null);
  const [weightConfirm, setWeightConfirm] = useState<WeightConfirm | null>(null);
  const [needsWeight, setNeedsWeight] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [weightError, setWeightError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const load = useCallback(async (s: Services, day: string) => {
    const dayView = await s.store.day(day);
    const profileRow = await getProfile(s.adapter, s.userId);
    const saved = await listSavedFoods(s.adapter, s.userId);
    const recents = await listRecents(s.adapter, s.userId, 8);
    const seen = new Set<string>();
    const merged: Suggestion[] = [];
    for (const row of saved) {
      if (row.nickname && !seen.has(row.nickname)) {
        seen.add(row.nickname);
        merged.push({ label: row.nickname, text: row.raw_text });
      }
    }
    for (const text of recents) {
      if (!seen.has(text)) {
        seen.add(text);
        merged.push({ label: text, text });
      }
    }
    return { dayView, profileRow, suggestions: merged.slice(0, 12) };
  }, []);

  // store 'change' events bump a tick; the effect below re-reads the day
  const [changeTick, setChangeTick] = useState(0);

  // On focus: History (and the scrubber's "View all history") route back here
  // with ?day=, and a teach-sheet example / saved food / barcode hit parks one
  // line to write. Both are navigation-driven, so the focus effect — not a
  // render effect — is the sanctioned place to consume them.
  useFocusEffect(
    useCallback(() => {
      const day =
        typeof params.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.day)
          ? params.day
          : null;
      if (day) setSelectedDay(day);
      const line = takePendingLine();
      if (line && svc) void svc.store.addLine(line, day ?? selectedDay);
    }, [params.day, svc, selectedDay]),
  );

  // boot: services, store events, connectivity-driven drain, sync tick
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let networkSub: { remove(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    services()
      .then((s) => {
        if (disposed) return;
        setSvc(s);
        unsubscribe = s.store.on((event) => {
          if (event.type === 'change') setChangeTick((t) => t + 1);
          if (event.type === 'weightConfirm') setWeightConfirm(event);
          if (event.type === 'needsWeight') setNeedsWeight(true);
        });
        networkSub = Network.addNetworkStateListener((state) => {
          if (state.isInternetReachable) void s.syncTick();
        });
        // Audit M5: this was a flat 30-second setInterval that ran a full push
        // plus four paged selects whether or not anything had changed — ten
        // round trips a minute for an idle user, and the dominant database load
        // at scale. A self-rescheduling timeout instead, backing off while
        // nothing is happening and snapping back to 30s the moment something
        // is. The midnight rollover still runs on every wake-up, and the other
        // triggers (network state, app foreground) are unchanged, so a real
        // edit is never waiting on the backed-off interval alone.
        let idle = 0;
        const tick = async () => {
          setToday(dayKey(new Date())); // midnight rollover
          let worked = true;
          try {
            worked = await s.syncTick();
          } catch (error: unknown) {
            reportError(error, { screen: 'journal', op: 'syncTick' });
          }
          idle = worked ? 0 : idle + 1;
          if (!disposed) timer = setTimeout(() => void tick(), nextSyncDelay(idle));
        };
        timer = setTimeout(() => void tick(), nextSyncDelay(0));
      })
      .catch((error: unknown) => reportError(error, { screen: 'journal', op: 'boot' }));

    return () => {
      disposed = true;
      unsubscribe?.();
      networkSub?.remove();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!svc) return;
    let cancelled = false;
    load(svc, selectedDay)
      .then((data) => {
        if (cancelled) return;
        setView(data.dayView);
        setProfile(data.profileRow);
        setSuggestions(data.suggestions);
      })
      .catch((error: unknown) => reportError(error, { screen: 'journal', op: 'load' }));
    return () => {
      cancelled = true;
    };
  }, [svc, selectedDay, changeTick, load]);

  // Stable across renders so memoized children (JournalLine, SummaryCard,
  // SuggestionStrip) don't re-render on every keystroke. setState setters are
  // themselves stable; wrapping the inline closures makes their identity stable
  // too, which is what the memo() boundaries compare on.
  const openDetail = useCallback((line: DayLine) => setDetail(line), []);
  const openOptions = useCallback(() => setOptionsOpen(true), []);
  const pickSuggestion = useCallback((text: string) => {
    setInput(text);
    inputRef.current?.focus();
  }, []);

  if (gate === 'loading') return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  // typed routes regenerate on the next `expo start`; until then, cast
  if (gate === 'pending') return <Redirect href={'/onboarding' as Href} />;

  const submit = () => {
    const text = input.trim();
    if (!svc || text.length === 0) return;
    setInput('');
    void svc.store.addLine(text, selectedDay);
    inputRef.current?.focus(); // cursor is already on the next line
  };

  const submitWeight = () => {
    if (!svc) return;
    const kg = parseBounded(weightInput, BOUNDS.weightKg);
    if (kg === null) {
      // Was a silent no-op; the prompt just sat there with no signal. State
      // the range, factually (BRAND-VOICE 3), keep focus.
      setWeightError('Enter a weight between 30 and 250 kg.');
      return;
    }
    setWeightError(null);
    setNeedsWeight(false);
    setWeightInput('');
    void svc.store.provideBodyWeight(kg, selectedDay);
  };

  const hideCalories = (profile?.hide_calories ?? 0) === 1;
  const showMacros = (profile?.show_macros ?? 1) === 1;
  const title = selectedDay === today ? 'Today' : selectedDay;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.chrome}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Menu"
          onPress={() => setDrawerOpen(true)}
          style={[styles.iconBtn, { backgroundColor: colors.fill }]}
        >
          <Text style={[type.body, { color: colors.ink }]}>=</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scanner"
          onPress={() => router.push('/scanner' as Href)}
          style={[styles.iconBtn, { backgroundColor: colors.fill }]}
        >
          <Text style={[type.body, { color: colors.ink }]}>⛶</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={view?.lines ?? []}
          keyExtractor={(line) => line.entry.id}
          keyboardShouldPersistTaps="handled"
          onScrollEndDrag={(e) => {
            // pull down on "Today" → the day scrubber (spec/02 §B)
            if (e.nativeEvent.contentOffset.y < -40) setScrubbing(true);
          }}
          contentContainerStyle={styles.scroll}
          // Only visible lines mount — a heavy logging day (or a full history
          // day) no longer mounts every JournalLine + shimmer at once.
          initialNumToRender={20}
          windowSize={11}
          removeClippedSubviews
          renderItem={({ item }) => (
            <JournalLine line={item} hideCalories={hideCalories} onPress={openDetail} />
          )}
          ListHeaderComponent={
            <>
              <Pressable
                onPress={() => setScrubbing((s) => !s)}
                accessibilityRole="button"
                accessibilityLabel="Pick a day"
                style={styles.header}
              >
                <Text style={[type.title, { color: colors.ink }]}>{title}</Text>
                {!hideCalories && view && (
                  <Text
                    {...numberProps}
                    style={[type.number, styles.total, { color: colors.inkMute }]}
                  >
                    {Math.round(view.totals.netKcal).toLocaleString('en-IN')} cals
                    {view.totals.pendingCount > 0
                      ? `  ·  +${view.totals.pendingCount} pending`
                      : ''}
                  </Text>
                )}
              </Pressable>
              {scrubbing && (
                <DayScrubber
                  today={today}
                  selected={selectedDay}
                  onSelect={setSelectedDay}
                  onDone={() => setScrubbing(false)}
                />
              )}
            </>
          }
          ListFooterComponent={
            <>
              {weightConfirm && (
                <View style={[styles.inlinePrompt, { backgroundColor: colors.fill }]}>
                  <Text style={[type.label, { color: colors.ink }]}>
                    {weightConfirm.newKg} kg. That&apos;s{' '}
                    {Math.abs(weightConfirm.newKg - weightConfirm.prevKg).toFixed(1)} kg from your
                    last weigh-in. Save it?
                  </Text>
                  <View style={styles.promptRow}>
                    {(['Save', 'Not now'] as const).map((label) => (
                      <Pressable
                        key={label}
                        accessibilityRole="button"
                        onPress={() => {
                          void svc?.store.confirmWeight(weightConfirm.entryId, label === 'Save');
                          setWeightConfirm(null);
                        }}
                        style={[styles.promptBtn, { backgroundColor: colors.surface }]}
                      >
                        <Text style={[type.label, { color: colors.ink }]}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {needsWeight && (
                <View style={[styles.inlinePrompt, { backgroundColor: colors.fill }]}>
                  <Text style={[type.label, { color: colors.ink }]}>
                    We need your weight to work out exercise burn.
                  </Text>
                  <View style={styles.promptRow}>
                    <TextInput
                      value={weightInput}
                      onChangeText={setWeightInput}
                      onSubmitEditing={submitWeight}
                      keyboardType="numeric"
                      placeholder="kg"
                      placeholderTextColor={colors.inkMute}
                      accessibilityLabel="Your weight in kilograms"
                      maxFontSizeMultiplier={numberMaxFontScale}
                      style={[
                        type.number,
                        styles.weightInput,
                        { backgroundColor: colors.surface, color: colors.ink },
                      ]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      onPress={submitWeight}
                      style={[styles.promptBtn, { backgroundColor: colors.surface }]}
                    >
                      <Text style={[type.label, { color: colors.ink }]}>Save</Text>
                    </Pressable>
                  </View>
                  {weightError && (
                    <Text style={[type.label, styles.weightError, { color: colors.inkMute }]}>
                      {weightError}
                    </Text>
                  )}
                </View>
              )}

              <TextInput
                ref={inputRef}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={submit}
                blurOnSubmit={false}
                returnKeyType="done"
                placeholder="Write a food..."
                placeholderTextColor={colors.inkMute}
                accessibilityLabel="Write a food"
                style={[type.body, styles.input, { color: colors.ink }]}
              />
            </>
          }
        />

        <SuggestionStrip suggestions={suggestions} onPick={pickSuggestion} />

        {view && (
          <View style={styles.cardWrap}>
            <SummaryCard
              totals={view.totals}
              calorieGoal={profile?.calorie_goal ?? null}
              hideCalories={hideCalories}
              showMacros={showMacros}
              onPress={openOptions}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      <Drawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <OptionsSheet visible={optionsOpen} onClose={() => setOptionsOpen(false)} />
      <DetailSheet
        key={detail?.entry.id ?? 'none'}
        line={detail}
        hideCalories={hideCalories}
        onClose={() => setDetail(null)}
        onEditText={(id, text) => {
          setDetail(null);
          void svc?.store.editLine(id, text);
        }}
        onNickname={(id, nickname) => {
          void svc?.store.setNickname(id, nickname);
        }}
        onDelete={(id) => {
          setDetail(null);
          void svc?.store.deleteLine(id);
        }}
        onRetry={(id) => {
          setDetail(null);
          void svc?.store.retryLine(id);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  chrome: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  scroll: {
    paddingBottom: spacing.lg,
  },
  header: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  total: {
    marginTop: spacing.xs,
  },
  input: {
    paddingHorizontal: screenPadding,
    paddingVertical: spacing.xs,
  },
  inlinePrompt: {
    marginHorizontal: screenPadding,
    marginBottom: spacing.md,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  promptRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  weightError: {
    marginTop: spacing.sm,
  },
  promptBtn: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  weightInput: {
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 88,
  },
  cardWrap: {
    paddingBottom: spacing.sm,
  },
});
