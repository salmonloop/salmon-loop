import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    pool: 'threads',
    include: ['tests/perf/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    sequence: {
      shuffle: false,
      concurrent: false,
    },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
