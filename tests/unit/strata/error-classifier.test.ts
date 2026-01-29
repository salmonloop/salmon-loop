import { ErrorType } from '../../../src/core/types.js';
import { classifyError, isRetryable } from '../../../src/core/verify.js';

describe('Error Classifier Robustness (Migrated from legacy robustness.test.ts)', () => {
  describe('Classification Edge Cases', () => {
    it('should handle empty or whitespace output', () => {
      expect(classifyError('')).toBe(ErrorType.UNKNOWN);
      expect(classifyError('   ')).toBe(ErrorType.UNKNOWN);
      expect(classifyError('\n\t')).toBe(ErrorType.UNKNOWN);
    });

    it('should handle extremely long output without crashing', () => {
      const longOutput = 'a'.repeat(100000) + 'TS1234' + 'a'.repeat(100000);
      expect(classifyError(longOutput)).toBe(ErrorType.COMPILATION);
    });

    it('should handle weird characters in output', () => {
      const weirdOutput = 'Error: \u0000\u0001\u0002 TS1234';
      expect(classifyError(weirdOutput)).toBe(ErrorType.COMPILATION);
    });
  });

  describe('Retryability Contract', () => {
    it('should correctly identify retryable errors', () => {
      expect(isRetryable(ErrorType.COMPILATION)).toBe(true);
      expect(isRetryable(ErrorType.LINT)).toBe(true);
      expect(isRetryable(ErrorType.TEST)).toBe(true);
      expect(isRetryable(ErrorType.LOGIC)).toBe(true);
      expect(isRetryable(ErrorType.AST_VALIDATION_ERROR)).toBe(true);

      expect(isRetryable(ErrorType.DEPENDENCY_ERROR)).toBe(false);
      expect(isRetryable(ErrorType.RESOURCE_LOCK_ERROR)).toBe(false);
      expect(isRetryable(ErrorType.UNKNOWN)).toBe(false);
    });
  });
});
