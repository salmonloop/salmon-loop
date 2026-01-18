import { describe, it, expect } from 'vitest';
import { ErrorType } from '../../src/core/types.js';
import { classifyError } from '../../src/core/verify.js';

describe('classifyError', () => {
  it('should classify TypeScript errors as COMPILATION', () => {
    const output = 'error TS2322: Type "string" is not assignable to type "number".';
    expect(classifyError(output)).toBe(ErrorType.COMPILATION);
  });

  it('should classify ESLint errors as LINT', () => {
    const output = '  1:1  error  "foo" is defined but never used  no-unused-vars';
    expect(classifyError(output)).toBe(ErrorType.LINT);
  });

  it('should classify test failures as TEST', () => {
    const output = 'FAIL tests/unit/llm.test.ts\n  ● LLM › should create a plan\n    expect(received).toBe(expected)';
    expect(classifyError(output)).toBe(ErrorType.TEST);
  });

  it('should classify unknown output as LOGIC', () => {
    const output = 'Verification failed: unexpected behavior observed';
    expect(classifyError(output)).toBe(ErrorType.LOGIC);
  });

  it('should classify empty output as UNKNOWN', () => {
    expect(classifyError('')).toBe(ErrorType.UNKNOWN);
  });
});
