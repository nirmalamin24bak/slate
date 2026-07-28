import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest covers the pure core only: engine (spec/06), resolver (spec/05),
// db repos + sync + journal (spec/04, spec/02), onboarding draft. Native-only
// modules (the expo-sqlite adapter, supabase/revenuecat clients, the RN screen
// wiring) can't run under Node and are exercised by device/integration tests.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // React Native's global. Under Node it is undefined; define it so modules
  // that branch on __DEV__ (revenuecat dev override, report sink) can be tested.
  define: {
    __DEV__: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/engine/**',
        'src/resolver/**',
        'src/db/**',
        'src/journal/**',
        'src/onboarding/**',
        'src/stats/**',
        // Pure lib modules only — the rest of src/lib is RN/network-facing and
        // exercised on device (like src/db/expo.ts).
        'src/lib/export.ts',
        'src/lib/barcode.ts',
        // Phase-6: VoiceOver copy is pure and pinned (spec/03 accessibility).
        'src/components/a11y.ts',
      ],
      exclude: [
        '**/*.test.ts',
        // native-only, no Node runtime: covered on device
        'src/db/expo.ts',
      ],
      // Phase-1 gate: the engine computes what users eat — 100%, no dead branches.
      // Phase-2 gate: the resolver decides what those numbers refer to — same bar.
      // Phase-3/4 gate: journal + db + onboarding draft carry the offline
      // contract and the guardrails — high bar, but the RN-facing seams
      // (event emission plumbing) don't hit 100% under Node.
      thresholds: {
        'src/engine/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/resolver/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        // Raised 28 Jul 2026: branches were passing by 0.19pp, so the next
        // uncovered branch anywhere in src/db failed CI. Covering the down-sync
        // merges' sparse-payload fallbacks took the real number to 81.4%; the
        // floors below now sit under it with room, and above where it was.
        'src/db/**': { statements: 95, branches: 80, functions: 95, lines: 98 },
        // Raised 28 Jul 2026 (was 90/78/90/95, and branches sat at 79.11%).
        // The degraded inputs recompute has to survive — a barcode logged in
        // kilograms, a packaged row with no energy, an exercise whose ref left
        // the mirror, a stale steps burn — and the store's subscription seams
        // are now covered, taking branches to 84.58% and functions to 100%.
        // What remains uncovered is defensive coalescing that only fires on a
        // corrupt local mirror.
        'src/journal/**': { statements: 96, branches: 83, functions: 100, lines: 98 },
        'src/onboarding/**': { statements: 100, branches: 95, functions: 100, lines: 100 },
        // Phase-5 pure surfaces: stats aggregation and the export builder are
        // fully deterministic — 100%. barcode joined them 28 Jul 2026:
        // fetchOffProduct is now tested against a stubbed fetch (404, offline,
        // unparseable body all → null), so the file no longer needs a carve-out.
        'src/stats/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/lib/export.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/lib/barcode.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/components/a11y.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
