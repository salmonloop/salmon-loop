import { describe, it, expect } from 'bun:test';

import { sanitizeObject, sanitizeErrorMessage, normalizeContent } from '../../../src/core/utils/sanitizer.js';

describe('sanitizer', () => {
  describe('sanitizeErrorMessage', () => {
    it('should return Unknown error for falsy input', () => {
      expect(sanitizeErrorMessage(null)).toBe('Unknown error');
    });

    it('should extract message from Error object', () => {
      expect(sanitizeErrorMessage(new Error('SyntaxError: Unexpected token'))).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
    });

    it('should extract message from object when JSON.stringify throws', () => {
      // JSON.stringify throws on circular reference.
      // String(cyclicObj) gives "[object Object]" which is then processed.
      // "[object Object]" length is 15, contains "[", "]", "object", "Object".
      // Let's create an object that throws on stringify AND String(obj) gives something long or with blocked keywords.
      const cyclicObj: any = {
        toString() { return 'Error: very bad thing happened at somewhere'; }
      };
      cyclicObj.self = cyclicObj;
      expect(sanitizeErrorMessage(cyclicObj)).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
    });

    it('should return safe text as is', () => {
      expect(sanitizeErrorMessage('User aborted the operation')).toBe('User aborted the operation');
      expect(sanitizeErrorMessage('Hello')).toBe('Hello');
    });

    it('should block error messages with technical details', () => {
      expect(sanitizeErrorMessage('SyntaxError: Unexpected token')).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
      expect(sanitizeErrorMessage('failed to fetch data')).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
      expect(sanitizeErrorMessage('at Module._compile (node:internal/modules/cjs/loader:1356:14)')).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
    });
  });

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

    it('should handle arrays and respect maxDepth', () => {
      const arr = [[[{ level4: 'secret' }]]];
      const sanitized = sanitizeObject(arr, 3);
      expect(sanitized[0][0][0]).toBe('[DEPTH_EXCEEDED]');
    });

    it('should sanitize high risk fields that are strings', () => {
      const obj = { message: 'SyntaxError: Unexpected token' };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.message).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
    });

    it('should recursively sanitize high risk fields that are objects', () => {
      const obj = { details: { nested: 'value' } };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.details).toEqual({ nested: 'value' });
    });

    it('should preserve high risk fields that are neither string nor object', () => {
      const obj = { message: 123 };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.message).toBe(123);
    });

    it('should hide blacklisted fields', () => {
      const obj = { headers: { authorization: 'Bearer token' } };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.headers).toBe('[HIDDEN FOR SECURITY]');
    });

    it('should return [CIRCULAR] if recursive sanitizeObject throws', () => {
      // To make sanitizeObject throw, we can pass a proxy that throws on ownKeys
      const throwingProxy = new Proxy({}, {
        ownKeys() {
          throw new Error('Access denied');
        }
      });
      const obj = { nested: throwingProxy };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.nested).toBe('[CIRCULAR]');
    });
  });

  describe('normalizeContent', () => {
    it('should trim text', () => {
      expect(normalizeContent('  hello  ')).toBe('hello');
    });
  });
});
