import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';

import { prepareMessagePayload } from '../../../../../src/cli/ui/utils/sanitizer.js';

describe('UI Sanitizer Utils', () => {
  describe('prepareMessagePayload', () => {
    let originalMathRandom: typeof Math.random;

    beforeEach(() => {
      originalMathRandom = Math.random;
      // Mock Math.random to return a predictable value (0.123456789)
      Math.random = () => 0.123456789;
    });

    afterEach(() => {
      Math.random = originalMathRandom;
    });

    test('should return a properly structured payload for a valid UIEvent', () => {
      const fixedDate = new Date('2024-01-01T12:00:00Z');
      const ev = {
        type: 'user',
        content: 'Hello, world!',
        id: 'user-123',
        timestamp: fixedDate,
      };

      const result = prepareMessagePayload(ev);

      expect(result).toEqual({
        ...ev,
        id: 'user-123',
        type: 'user',
        content: 'Hello, world!',
        timestamp: fixedDate,
      });
    });

    test('should assign a random ID and current date if missing', () => {
      // Create fixed timestamp
      const fixedDate = new Date('2024-01-01T12:00:00Z');
      const mockDate = mock(() => fixedDate);

      const ev = {
        content: 'No ID or timestamp here',
      };

      // Temporarily swap the prototype of Date to inject our mock date
      const originalDate = global.Date;
      const OriginalDate = global.Date;

      global.Date = class extends OriginalDate {
        constructor() {
          super();
          return mockDate();
        }
      } as DateConstructor;

      try {
        const result = prepareMessagePayload(ev);
        expect(result.id).toBe(`sys-${(0.123456789).toString(36).substring(7)}`); // Result of predictable random mock
        expect(result.type).toBe('system');
        expect(result.content).toBe('No ID or timestamp here');
        expect(result.timestamp).toEqual(fixedDate);
      } finally {
        global.Date = originalDate;
      }
    });

    test('should sanitize content correctly', () => {
      const ev = {
        content: 'Error message: ["invalid_type"]',
      };

      const result = prepareMessagePayload(ev);

      expect(result.content).toBe('Error: Invalid input parameters (Validation failed)');
    });

    test('should normalize legacy type "ai" to "assistant"', () => {
      const ev = {
        type: 'ai',
        content: 'I am an AI',
      };

      const result = prepareMessagePayload(ev);

      expect(result.type).toBe('assistant');
    });

    test('should fall back to "system" for unknown type', () => {
      const ev = {
        type: 'unknown_type',
        content: 'Something unknown',
      };

      const result = prepareMessagePayload(ev);

      expect(result.type).toBe('system');
    });
  });
});
