import { TextNormalizer } from '../../src/utils/eol.js';

describe('TextNormalizer', () => {
  describe('read() - Detection & Normalization', () => {
    it('should detect and normalize CRLF', () => {
      const input = 'foo\r\nbar\r\nbaz';
      const result = TextNormalizer.read(input);
      expect(result.eol).toBe('\r\n');
      expect(result.normalized).toBe('foo\nbar\nbaz');
    });

    it('should detect and handle LF', () => {
      const input = 'foo\nbar\nbaz';
      const result = TextNormalizer.read(input);
      expect(result.eol).toBe('\n');
      expect(result.normalized).toBe('foo\nbar\nbaz');
    });

    it('should handle mixed line endings (majority wins rule)', () => {
      // 3 CRLF vs 1 LF -> Should be CRLF
      const input = 'a\r\nb\r\nc\r\nd\ne';
      const result = TextNormalizer.read(input);
      expect(result.eol).toBe('\r\n');
      expect(result.normalized).toBe('a\nb\nc\nd\ne');
    });
  });

  describe('restore() - Restoration', () => {
    it('should restore LF back to CRLF', () => {
      const normalized = 'foo\nbar';
      const restored = TextNormalizer.restore(normalized, '\r\n');
      expect(restored).toBe('foo\r\nbar');
    });

    it('should NOT create double carriage returns (safe check)', () => {
      // Assume input accidentally has mixed \r\n, restoring CRLF should not make it \r\r\n
      const mixed = 'foo\r\nbar\n';
      const restored = TextNormalizer.restore(mixed, '\r\n');
      expect(restored).toBe('foo\r\nbar\r\n');
    });

    it('should keep content as LF if target is LF', () => {
      const normalized = 'foo\nbar';
      const restored = TextNormalizer.restore(normalized, '\n');
      expect(restored).toBe('foo\nbar');
    });
  });
});
