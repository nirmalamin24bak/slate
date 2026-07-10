import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

// Journal (home) — placeholder scaffold only.
// The real multiline editor, line state machine, shimmer, totals, and
// summary card are built in Phase 3 (spec/02 §B, spec/09). This exists so
// the app boots to the journal route with correct background per spec/03.
export default function Journal() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Today</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Colours inlined here are the spec/03 light tokens (bg, ink). They will be
  // replaced by the typed theme module in Phase 0 (todo 5); no component should
  // carry raw hex once that lands.
  screen: {
    flex: 1,
    backgroundColor: '#F7F7F5', // bg
  },
  header: {
    paddingHorizontal: 24, // lg
    paddingTop: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.56, // -0.02em at 28px
    color: '#111214', // ink
  },
});
