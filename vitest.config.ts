import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // Global setup file (runs before each test)
    setupFiles: ['./tests/setup.ts'],

    // Test file patterns
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],

    // Special pool configuration for race condition tests
    poolMatchGlobs: [
      ['tests/unit/race_conditions.test.ts', 'forks'],
      // ARCHITECTURE OPTIMIZATION: Use 'forks' for integration tests.
      // This provides process-level isolation (separate CWD/memory), preventing
      // "not a git repository" errors caused by thread pollution.
      ['tests/integration/**/*.test.ts', 'forks'],
    ],

    poolOptions: {
      forks: {
        singleFork: false, // Allow multiple forks for parallelism
        minForks: 1,
        maxForks: 4, // Limit concurrency to avoid file lock contention
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
        'src/cli.ts', // CLI entry point
      ],
    },
  },
});
