import { describe, it, expect } from 'bun:test';

import { sanitizeObject, normalizeContent } from '../../../src/core/utils/sanitizer.js';

describe('sanitizer', () => {
  describe('sanitizeObject', () => {
    it('should stop recursion at default MAX_DEPTH', () => {
      // Default MAX_DEPTH should be 5
      const deepObj: any = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: 'secret',
                },
              },
            },
          },
        },
      };
      const sanitized = sanitizeObject(deepObj);
      expect(sanitized.level1.level2.level3.level4.level5).toBe('[DEPTH_EXCEEDED]');
    });

    it('should stop recursion at custom MAX_DEPTH', () => {
      const deepObj: any = { a: { b: { c: { d: { e: 'secret' } } } } };
      // Passing custom depth 2
      const sanitized = sanitizeObject(deepObj, 2);
      expect(sanitized.a.b).toBe('[DEPTH_EXCEEDED]');
    });

    it('should preserve properties within depth limit', () => {
      const obj = { a: { b: 'safe' } };
      const sanitized = sanitizeObject(obj, 2);
      expect(sanitized.a.b).toBe('safe');
    });
  });

  describe('normalizeContent', () => {
    it('should remove leading and trailing whitespace', () => {
      expect(normalizeContent('  hello world  ')).toBe('hello world');
      expect(normalizeContent('\t\n test \n\t')).toBe('test');
    });

    it('should preserve internal spaces', () => {
      expect(normalizeContent('hello   world')).toBe('hello   world');
    });

    it('should preserve special characters like hyphens and underscores', () => {
      expect(normalizeContent('my-special_string-123')).toBe('my-special_string-123');
      expect(normalizeContent('  another-test_case!@#  ')).toBe('another-test_case!@#');
    });

    it('should handle empty and whitespace-only strings', () => {
      expect(normalizeContent('')).toBe('');
      expect(normalizeContent('   ')).toBe('');
      expect(normalizeContent('\n\t\r')).toBe('');
    });
  });
});
