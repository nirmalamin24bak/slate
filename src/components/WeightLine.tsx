// Weight line (spec/02 §E). One series: 2px ink line, dot markers, recessive
// baseline. The headline (latest weight) lives on the card, not the plot.

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import type { WeightPoint } from '@/stats/aggregate';
import { daysBetween } from '@/journal';
import { useTheme } from '@/theme';

const CHART_HEIGHT = 120;
const PAD = 8;

export function WeightLine({ points }: { points: readonly WeightPoint[] }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;

  const span = Math.max(daysBetween(first.log_date, last.log_date), 1);
  const kgs = points.map((p) => p.weight_kg);
  const min = Math.min(...kgs) - 0.5;
  const max = Math.max(...kgs) + 0.5;

  const x = (p: WeightPoint) =>
    PAD + ((width - PAD * 2) * daysBetween(first.log_date, p.log_date)) / span;
  const y = (p: WeightPoint) =>
    PAD + (CHART_HEIGHT - PAD * 2) * (1 - (p.weight_kg - min) / (max - min));

  return (
    <View
      style={styles.chart}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityLabel="Weight over time"
    >
      {width > 0 && (
        <Svg width={width} height={CHART_HEIGHT}>
          <Line
            x1={PAD}
            y1={CHART_HEIGHT - PAD}
            x2={width - PAD}
            y2={CHART_HEIGHT - PAD}
            stroke={colors.hairline}
            strokeWidth={1}
          />
          {points.length > 1 && (
            <Polyline
              points={points.map((p) => `${x(p)},${y(p)}`).join(' ')}
              fill="none"
              stroke={colors.ink}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {points.map((p) => (
            <Circle key={p.log_date} cx={x(p)} cy={y(p)} r={4} fill={colors.ink} />
          ))}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    height: CHART_HEIGHT,
  },
});
