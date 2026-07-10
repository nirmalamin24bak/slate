import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest covers the pure core only: engine (spec/06), resolver (spec/05),
// db sync logic, lib utilities. React Native components are exercised by
// integration/device tests, not by this runner.
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
      include: ['src/engine/**', 'src/resolver/**', 'src/db/**', 'src/lib/**'],
      exclude: ['**/*.test.ts'],
    },
  },
});
