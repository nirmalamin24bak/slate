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
        'src/db/**': { statements: 90, branches: 75, functions: 90, lines: 90 },
        // journal branches sit below the engine/resolver bar because the
        // uncovered ones are defensive nullish-coalescing on already-parsed
        // date parts (dates.ts `?? 1970`) and recompute lookup-miss paths
        // that only fire on a corrupt local mirror. The reachable offline
        // contract — queue, drain, requeue, degrade — is fully exercised.
        'src/journal/**': { statements: 90, branches: 78, functions: 90, lines: 95 },
        'src/onboarding/**': { statements: 100, branches: 95, functions: 100, lines: 100 },
        // Phase-5 pure surfaces: stats aggregation and the export builder are
        // fully deterministic — 100%. barcode's parseOffResponse is fully
        // covered; the lines below its bar are fetchOffProduct, the network
        // wrapper exercised on device (same carve-out as src/db/expo.ts).
        'src/stats/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/lib/export.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/lib/barcode.ts': { statements: 65, branches: 90, functions: 75, lines: 65 },
        'src/components/a11y.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
