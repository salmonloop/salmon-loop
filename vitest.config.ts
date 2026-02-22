import { readFileSync } from 'fs';
import path from 'path';

import { defineConfig } from 'vitest/config';

const bunMigratedFiles = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'tests', 'bun-migrated-files.json'), 'utf-8'),
) as string[];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Keep CI output clean: tests must be self-validating and not rely on console output.
    silent: true,

    // Global setup file (runs before each test)
    setupFiles: ['./tests/setup.ts'],

    // Use standard pool for better performance now that mock-fs is removed
    pool: 'threads',

    // Test file patterns
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['tests/perf/**', 'tests/bun/**', ...bunMigratedFiles],

    // Run integration tests in isolated forks to avoid git lock contention
    // Run UI tests in jsdom environment for React hooks
    poolMatchGlobs: [
      ['tests/integration/**', 'forks'],
      ['tests/unit/cli/ui/**', 'threads'],
    ],

    alias: {
      'yoga-layout': 'yoga-layout/load',
    },

    // Environment per test file
    environmentMatchGlobs: [
      ['tests/unit/cli/ui/**', 'jsdom'],
      ['tests/integration/cli-ui-*.test.tsx', 'jsdom'],
    ],

    poolOptions: {
      forks: {
        singleFork: false, // Ensure integration tests run in isolated forks
        minForks: 1,
        maxForks: 4,
      },
      threads: {
        singleThread: false,
      },
    },

    // Test execution sequence
    sequence: {
      shuffle: false, // Deterministic test order
      concurrent: false, // ❌ Disable concurrent execution within files to prevent shared state race conditions
    },

    // Timeouts (integration tests may take longer)
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/cli/index.ts', // CLI entry point
      ],
    },
  },
});
