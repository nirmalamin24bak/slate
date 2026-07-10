// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions is Deno (Deno.serve, npm: specifiers) — outside the
    // RN toolchain; reviewed by hand and by the eval harness instead.
    ignores: ['dist/**', 'node_modules/**', '.expo/**', 'coverage/**', 'supabase/functions/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // CLAUDE.md: no `any`. Escape hatch is `unknown` + narrowing.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
]);
