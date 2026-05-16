import { describe, it, expect } from 'bun:test';

import { sanitizeObject, sanitizeErrorMessage } from '../../../src/core/utils/sanitizer.js';

describe('sanitizer', () => {
  describe('sanitizeErrorMessage', () => {
    it('should return "Unknown error" for falsy values', () => {
      expect(sanitizeErrorMessage(null)).toBe('Unknown error');
      expect(sanitizeErrorMessage(undefined)).toBe('Unknown error');
      expect(sanitizeErrorMessage('')).toBe('Unknown error');
      expect(sanitizeErrorMessage(0)).toBe('Unknown error');
      expect(sanitizeErrorMessage(false)).toBe('Unknown error');
    });

    it('should return the exact string for safe text', () => {
      expect(sanitizeErrorMessage('Invalid input')).toBe('Invalid input');
      expect(sanitizeErrorMessage('Try again later')).toBe('Try again later');
    });

    it('should allow known safe strings regardless of length or content', () => {
      expect(sanitizeErrorMessage('User aborted the operation')).toBe('User aborted the operation');
      expect(sanitizeErrorMessage('Operation cancelled')).toBe('Operation cancelled');
      expect(sanitizeErrorMessage('Request timed out')).toBe('Request timed out');
    });

    it('should hide technical details for unsafe text', () => {
      const hidden = 'ERR_TECHNICAL_DETAILS_HIDDEN';
      expect(sanitizeErrorMessage('Connection error occurred')).toBe(hidden);
      expect(sanitizeErrorMessage('System Error')).toBe(hidden);
      expect(sanitizeErrorMessage('Request failed')).toBe(hidden);
      expect(sanitizeErrorMessage('NullPointerException')).toBe(hidden);
      expect(sanitizeErrorMessage('Invalid JSON: unexpected token')).toBe(hidden);
      expect(sanitizeErrorMessage('Object { foo: "bar" }')).toBe(hidden);
      expect(sanitizeErrorMessage('Path /usr/bin/node')).toBe(hidden);
      expect(sanitizeErrorMessage('Service Unavailable')).toBe(hidden);
      expect(sanitizeErrorMessage('Resource Not Found')).toBe(hidden);
    });

    it('should hide messages that look like stack traces', () => {
      expect(
        sanitizeErrorMessage('at Module._compile (internal/modules/cjs/loader.js:1138:30)'),
      ).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
    });

    it('should hide messages longer than 100 characters unless known safe', () => {
      const longMessage = 'a'.repeat(101);
      expect(sanitizeErrorMessage(longMessage)).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
    });

    it('should handle Error instances', () => {
      expect(sanitizeErrorMessage(new Error('Safe message'))).toBe('Safe message');
      expect(sanitizeErrorMessage(new Error('Connection error'))).toBe(
        'ERR_TECHNICAL_DETAILS_HIDDEN',
      );
    });

    it('should stringify and sanitize plain objects', () => {
      const obj = { foo: 'bar' };
      // stringified contains '{'
      expect(sanitizeErrorMessage(obj)).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
    });

    it('should handle circular objects gracefully', () => {
      const obj: any = {};
      obj.self = obj;
      // String(obj) typically yields "[object Object]" which doesn't trigger any block rule on its own,
      // but if the fallback logic or properties hit the block list it should be safe.
      // "[object Object]" is 15 chars, no banned words.
      expect(sanitizeErrorMessage(obj)).toBe('[object Object]');
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
  });
});
