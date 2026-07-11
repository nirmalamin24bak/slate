// Customize display (spec/02 §F). Toggles the visible columns. Hide calorie
// counts is free and stays free — the affordance that lets someone with a
// difficult relationship to numbers use the journal at all (non-negotiable).
// The switch reads "show", stored as hide_calories inverted.

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Toggle } from '@/components/Toggle';
import { useDisplayToggles } from '@/lib/displayToggles';
import { usePlus } from '@/lib/plus';
import { screenPadding, spacing, type, useTheme } from '@/theme';

export default function CustomizeDisplay() {
  const { colors } = useTheme();
  const plus = usePlus();
  const { state, setToggle } = useDisplayToggles();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Customize display" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {state && (
          <>
            <Toggle
              label="Show macros"
              value={state.show_macros}
              onValueChange={(v) => setToggle('show_macros', v)}
            />
            <Toggle
              label="Show fiber & sugar"
              plus={!plus}
              disabled={!plus}
              value={plus && state.show_fiber_sugar}
              onValueChange={(v) => setToggle('show_fiber_sugar', v)}
            />
            <Toggle
              label="Show exercise"
              value={state.show_exercise}
              onValueChange={(v) => setToggle('show_exercise', v)}
            />
            <Toggle
              label="Show weight"
              value={state.show_weight}
              onValueChange={(v) => setToggle('show_weight', v)}
            />
            <Toggle
              label="Show water"
              value={state.show_water}
              onValueChange={(v) => setToggle('show_water', v)}
            />
            <Toggle
              label="Show steps"
              value={state.show_steps}
              onValueChange={(v) => setToggle('show_steps', v)}
            />
            <Toggle
              label="Show sleep"
              plus={!plus}
              disabled={!plus}
              value={plus && state.show_sleep}
              onValueChange={(v) => setToggle('show_sleep', v)}
            />

            <View style={[styles.divider, { backgroundColor: colors.hairline }]} />

            {/* Stored inverted: the switch shows calories when hide is off. */}
            <Toggle
              label="Hide calorie counts"
              value={state.hide_calories}
              onValueChange={(v) => setToggle('hide_calories', v)}
            />
            <Text style={[type.caption, styles.note, { color: colors.inkMute }]}>
              Hides every calorie figure. Macros, fiber, and sugar stay.
            </Text>
          </>
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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.md,
  },
  note: {
    marginTop: spacing.xs,
  },
});
