import { describe, expect, it } from 'bun:test';

import { ErrorType } from '../../src/core/types/index.js';
import { classifyError } from '../../src/core/verification/runner.js';
import { typescriptPlugin } from '../../src/languages/typescript/index.js';

describe('verify error classification order', () => {
  it('prefers TEST over LINT when verify output contains both lint command and test failure', () => {
    const output = [
      '$ bun run lint',
      '$ eslint .',
      '$ bun run test:full',
      'Bun file tests failed in:',
      '- tests/unit/core/grizzco/benchmarks/caching.bench.ts',
      'error: script "test:unit" exited with code 1',
    ].join('\n');

    expect(classifyError(output)).toBe(ErrorType.TEST);
  });

  it('prefers TEST over LINT in TypeScript plugin diagnostics for mixed verify logs', () => {
    const output = [
      '$ bun run lint',
      '$ eslint .',
      '$ bun run test:full',
      'Bun file tests failed in:',
      '- tests/unit/core/grizzco/benchmarks/caching.bench.ts',
      'error: script "test:unit" exited with code 1',
    ].join('\n');

    expect(typescriptPlugin.diagnostics.classifyError(output)).toBe(ErrorType.TEST);
  });

  it('classifies oxfmt format check failures as LINT in TypeScript plugin diagnostics', () => {
    const output = [
      '$ bun run format:check',
      'Checking formatting...',
      'src/index.ts (0ms)',
      'Format issues found in above 1 files.',
      'error: script "format:check" exited with code 1',
    ].join('\n');

    expect(typescriptPlugin.diagnostics.classifyError(output)).toBe(ErrorType.LINT);
  });
});
