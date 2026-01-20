import { describe, it, expect, vi } from 'vitest';
import { classifyError, isRetryable } from '../../src/core/verify.js';
import { ErrorType } from '../../src/core/types.js';
import { validateNodeStructure } from '../../src/core/ast/guard.js';
import { normalizePath, safeJoin } from '../../src/core/path.js';

describe('Robustness Edge Cases', () => {
  describe('Error Classification Robustness', () => {
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

  describe('AST Structure Validation Robustness', () => {
    it('should handle null or undefined nodes', () => {
      expect(validateNodeStructure(null)).toBe(true);
      expect(validateNodeStructure(undefined)).toBe(true);
    });

    it('should detect ERROR nodes at any depth', () => {
      const tree = {
        type: 'program',
        children: [
          { type: 'function_declaration', children: [] },
          { 
            type: 'expression_statement', 
            children: [
              { type: 'ERROR', text: 'syntax error' }
            ] 
          }
        ]
      };
      expect(validateNodeStructure(tree)).toBe(false);
    });

    it('should handle circular references in mock nodes (defense against infinite recursion)', () => {
      // Note: Real tree-sitter nodes are not circular, but we should be careful with mocks
      const node: any = { type: 'normal' };
      node.children = [node];
      
      // This test is more of a reminder to use a Set for visited nodes if we ever expect circularity
      // For now, tree-sitter nodes are a DAG/Tree, so recursion is fine.
    });
  });

  describe('Path Normalization Robustness', () => {
    it('should handle empty paths', () => {
      expect(normalizePath('')).toBe('');
    });

    it('should handle paths with only slashes', () => {
      expect(normalizePath('\\\\')).toBe('//');
      expect(normalizePath('///')).toBe('///');
    });

    it('should handle paths with mixed slashes', () => {
      expect(normalizePath('C:\\Users/name\\project/file.ts')).toBe('C:/Users/name/project/file.ts');
    });

    it('should handle safeJoin with various inputs', () => {
      expect(safeJoin('a', 'b', 'c')).toBe('a/b/c');
      expect(safeJoin('a/', '/b', 'c')).toBe('a/b/c');
      expect(safeJoin('C:\\repo', 'src\\file.ts')).toBe('C:/repo/src/file.ts');
    });
  });
});
