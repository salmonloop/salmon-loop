import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}', 'tests/*.{js,mjs,cjs,ts,mts,cts}'],
    poolMatchGlobs: [['tests/unit/race_conditions.test.ts', 'forks']],
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
