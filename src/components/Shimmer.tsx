// The resolve shimmer (spec/03): a horizontal gradient sweep beneath a
// resolving line, ~900ms ease-out, looped. Barely there — the line breathing,
// not a loading bar. Reduced motion → static 30%-opacity fill.

import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

import { motion, shimmer } from '@/theme';

const HEIGHT = 2;

// spec/03 sweep: transparent → mint 12% → indigo 18% → transparent
const MINT = `rgba(127, 191, 168, ${shimmer.mintOpacity})`;
const INDIGO = `rgba(62, 92, 158, ${shimmer.indigoOpacity})`;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

export function Shimmer({ width }: { width: number }) {
  const reduced = useReducedMotion();
  // Animated.Value in state, not a ref: it's stable across renders and the
  // interpolation below is a value read the ref lint would reject.
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: motion.shimmerDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, sweep]);

  if (reduced) {
    return (
      <View
        style={[styles.track, { width, backgroundColor: shimmer.indigo, opacity: 0.3 }]}
        accessibilityElementsHidden
      />
    );
  }

  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, width],
  });

  return (
    <View style={[styles.track, { width }]} accessibilityElementsHidden>
      <Animated.View style={{ transform: [{ translateX }] }}>
        <LinearGradient
          colors={['transparent', MINT, INDIGO, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ width, height: HEIGHT }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    overflow: 'hidden',
    borderRadius: HEIGHT / 2,
  },
});
