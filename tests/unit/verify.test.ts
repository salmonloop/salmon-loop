import { ErrorType } from '../../src/core/types.js';
import { classifyError } from '../../src/core/verify.js';

// Mock plugin registry to simulate language plugins
vi.mock('../../src/core/plugin/registry.js', () => ({
  pluginRegistry: {
    getAll: () => [
      {
        diagnostics: {
          classifyError: (output: string) => {
            if (output.includes('TS2322') || output.includes('Failed to compile'))
              return ErrorType.COMPILATION;
            if (output.includes('eslint') || output.includes('prettier')) return ErrorType.LINT;
            if (
              output.includes('FAIL') ||
              output.includes('Test Files') ||
              output.includes('AssertionError')
            )
              return ErrorType.TEST;
            return undefined;
          },
        },
      },
    ],
  },
}));

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
