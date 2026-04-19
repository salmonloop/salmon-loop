import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { prepareMessagePayload } from '../../../../../src/cli/ui/utils/sanitizer.js';

describe('sanitizer', () => {
  describe('prepareMessagePayload', () => {
    let originalRandom: typeof Math.random;

    beforeEach(() => {
      originalRandom = Math.random;
    });

    afterEach(() => {
      Math.random = originalRandom;
    });

    it('should preserve existing id, timestamp, type, and sanitize content', () => {
      const fixedDate = new Date('2024-01-01T00:00:00.000Z');
      const payload = prepareMessagePayload({
        id: 'custom-id',
        type: 'user',
        content: 'Hello world',
        timestamp: fixedDate,
        extraProp: 'value',
      });

      expect(payload).toEqual(
        expect.objectContaining({
          id: 'custom-id',
          type: 'user',
          content: 'Hello world',
          timestamp: fixedDate,
          extraProp: 'value',
        }),
      );
    });

    it('should generate a default sys- id if not provided', () => {
      Math.random = () => 0.123456789;
      const payload = prepareMessagePayload({
        content: 'Test content',
      });

      expect(payload.id).toBe(`sys-${(0.123456789).toString(36).substring(7)}`);
    });

    it('should normalize legacy "ai" type to "assistant"', () => {
      const payload = prepareMessagePayload({
        type: 'ai',
        content: 'Response',
      });

      expect(payload.type).toBe('assistant');
    });

    it('should default to "system" type if not provided', () => {
      const payload = prepareMessagePayload({
        content: 'System notice',
      });

      expect(payload.type).toBe('system');
    });

    it('should generate a current Date for timestamp if not provided', () => {
      const before = new Date().getTime();
      const payload = prepareMessagePayload({
        content: 'Notice',
      });
      const after = new Date().getTime();

      expect(payload.timestamp).toBeInstanceOf(Date);
      expect(payload.timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp.getTime()).toBeLessThanOrEqual(after);
    });

    it('should sanitize long content using sanitizeMessage', () => {
      const longString = 'a'.repeat(10000);
      const payload = prepareMessagePayload({
        content: longString,
      });

      expect(payload.content.length).toBeLessThan(10000);
      expect(payload.content.endsWith('...')).toBe(true);
    });
  });
});
