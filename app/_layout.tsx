import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// Root navigation shell. Screens are files under app/.
// Header is hidden globally; the journal supplies its own minimal chrome
// (spec/02 §B — two circular buttons only). Real theming lands with the
// theme module (Phase 0, todo 5).
export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
