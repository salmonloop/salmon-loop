import { describe, it, expect } from 'bun:test';

import { sanitizeObject } from '../../../src/core/utils/sanitizer.js';

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
});
