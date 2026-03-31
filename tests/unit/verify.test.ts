import { ErrorType } from '../../src/core/types/index.js';
import { classifyError } from '../../src/core/verification/runner.js';

describe('classifyError', () => {
  it('should classify TypeScript errors as COMPILATION', () => {
    const output = 'error TS2322: Type "string" is not assignable to type "number".';
    expect(classifyError(output)).toBe(ErrorType.COMPILATION);
  });

  it('should classify "failed to compile" as COMPILATION', () => {
    expect(classifyError('Failed to compile: src/index.ts')).toBe(ErrorType.COMPILATION);
  });

  it('should classify ESLint errors as LINT', () => {
    const output = '  1:1  error  "foo" is defined but never used  no-unused-vars  eslint';
    expect(classifyError(output)).toBe(ErrorType.LINT);
  });

  it('should classify Prettier errors as LINT', () => {
    expect(classifyError('prettier/prettier: Insert ;')).toBe(ErrorType.LINT);
  });

  it('should classify oxfmt format check failures as LINT', () => {
    const output = [
      '$ bun run format:check',
      'Checking formatting...',
      'src/index.ts (0ms)',
      'Format issues found in above 1 files.',
      'error: script "format:check" exited with code 1',
    ].join('\n');

    expect(classifyError(output)).toBe(ErrorType.LINT);
  });

  it('should classify test failures as TEST', () => {
    const output =
      'FAIL tests/unit/llm.test.ts\n  ● LLM › should create a plan\n    expect(received).toBe(expected)';
    expect(classifyError(output)).toBe(ErrorType.TEST);
  });

  it('should classify Vitest "test files" failure as TEST', () => {
    expect(classifyError('Test Files 1 failed')).toBe(ErrorType.TEST);
  });

  it('should classify Pytest failure as TEST', () => {
    expect(classifyError('E       AssertionError: assert 1 == 2')).toBe(ErrorType.TEST);
  });

  it('should classify unknown output as LOGIC', () => {
    const output = 'Verification failed: unexpected behavior observed';
    expect(classifyError(output)).toBe(ErrorType.LOGIC);
  });

  it('should classify empty output as UNKNOWN', () => {
    expect(classifyError('')).toBe(ErrorType.UNKNOWN);
  });
});
