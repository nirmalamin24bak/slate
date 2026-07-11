// One journal line (spec/02 §B, spec/03): body text left, tabular number
// right. Exercise numbers are muted with a leading −. Weight/water/sleep and
// sub-3,000 steps show ✓. Counted-elsewhere lines show ✓ included. Unresolved
// shows ↻. A resolving line breathes (shimmer) and its number settles in.
//
// VoiceOver reads the whole line as one utterance: "2 rotis, 220 calories".

import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DayLine } from '@/journal';
import { journalLineGap, motion, numberProps, screenPadding, type, useTheme } from '@/theme';

import { formatKcal, journalLineLabel } from './a11y';
import { Shimmer } from './Shimmer';
import { useReducedMotion } from './useReducedMotion';

/** The number settle: fade in and rise 4px, 180ms (spec/03 motion #2). */
function SettledNumber({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) {
      anim.setValue(1); // no settle, just the number
      return;
    }
    Animated.timing(anim, {
      toValue: 1,
      duration: motion.settleDurationMs,
      useNativeDriver: true,
    }).start();
  }, [anim, reduced]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [motion.settleRisePx, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

export interface JournalLineProps {
  line: DayLine;
  hideCalories: boolean;
  onPress(): void;
}

export function JournalLine({ line, hideCalories, onPress }: JournalLineProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const { display, entry } = line;

  const right = (() => {
    if (hideCalories && (display.kind === 'kcal' || display.kind === 'burn')) {
      return (
        <Text {...numberProps} style={[type.number, { color: colors.inkMute }]}>
          ✓
        </Text>
      );
    }
    switch (display.kind) {
      case 'kcal':
        return (
          <SettledNumber key={`${entry.id}-${display.value}`}>
            <Text {...numberProps} style={[type.number, { color: colors.ink }]}>
              {formatKcal(display.value)}
            </Text>
          </SettledNumber>
        );
      case 'burn':
        return (
          <SettledNumber key={`${entry.id}-${display.value}`}>
            <Text {...numberProps} style={[type.number, { color: colors.inkMute }]}>
              −{formatKcal(-display.value)}
            </Text>
          </SettledNumber>
        );
      case 'check':
        return (
          <Text {...numberProps} style={[type.number, { color: colors.inkMute }]}>
            ✓
          </Text>
        );
      case 'included':
        return (
          <View style={styles.includedWrap}>
            <Text style={[type.caption, { color: colors.inkMute }]}>included</Text>
            <Text {...numberProps} style={[type.number, { color: colors.inkMute }]}>
              ✓
            </Text>
          </View>
        );
      case 'retry':
        return (
          <Text {...numberProps} style={[type.number, { color: colors.inkMute }]}>
            ↻
          </Text>
        );
      default:
        return null; // pending — the shimmer below carries the state
    }
  })();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={journalLineLabel(entry.raw_text, line.display, hideCalories)}
      style={styles.row}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <View style={styles.lineRow}>
        <Text style={[type.body, styles.text, { color: colors.ink }]} numberOfLines={2}>
          {entry.raw_text}
        </Text>
        <View style={styles.right}>{right}</View>
      </View>
      {display.kind === 'pending' && width > 0 ? <Shimmer width={width} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: screenPadding,
    marginBottom: journalLineGap,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  text: {
    flex: 1,
    paddingRight: 12,
  },
  right: {
    alignItems: 'flex-end',
  },
  includedWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
