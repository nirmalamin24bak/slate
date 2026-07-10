// Calories bar chart (spec/02 §E). Single series → ink, no legend. Thin bars,
// rounded data-ends, baseline-anchored, 2px gaps. Unlogged buckets render as
// grey skeleton bars (spec/09: no text). Numbers live on the card header, not
// on every bar.

import { StyleSheet, View } from 'react-native';

import type { CalorieBucket } from '@/stats/aggregate';
import { useTheme } from '@/theme';

const CHART_HEIGHT = 120;
const SKELETON_RATIO = 0.35;

export function CalorieBars({ buckets }: { buckets: readonly CalorieBucket[] }) {
  const { colors } = useTheme();
  const max = Math.max(...buckets.map((b) => b.netKcal ?? 0), 1);
  return (
    <View style={styles.chart} accessibilityLabel="Daily calories">
      {buckets.map((bucket) => {
        const logged = bucket.netKcal !== null;
        const h = logged
          ? Math.max((CHART_HEIGHT * (bucket.netKcal ?? 0)) / max, 4)
          : CHART_HEIGHT * SKELETON_RATIO;
        return (
          <View key={bucket.start} style={styles.slot}>
            <View
              style={[
                styles.bar,
                { height: h, backgroundColor: logged ? colors.ink : colors.fill },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    height: CHART_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  slot: {
    flex: 1,
    alignItems: 'stretch',
  },
  bar: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
});
