import { TextNormalizer } from '../../../src/utils/eol.js';

describe('TextNormalizer', () => {
  describe('read()', () => {
    it('detects and normalizes LF', () => {
      const result = TextNormalizer.read('foo\nbar\nbaz');
      expect(result.eol).toBe('\n');
      expect(result.normalized).toBe('foo\nbar\nbaz');
    });

    it('detects and normalizes CRLF', () => {
      const result = TextNormalizer.read('foo\r\nbar\r\nbaz');
      expect(result.eol).toBe('\r\n');
      expect(result.normalized).toBe('foo\nbar\nbaz');
    });

    it('detects LF when starting with LF', () => {
      const result = TextNormalizer.read('\nfoo\nbar');
      expect(result.eol).toBe('\n');
      expect(result.normalized).toBe('\nfoo\nbar');
    });

    it('handles consecutive LF', () => {
      const result = TextNormalizer.read('foo\n\n\nbar');
      expect(result.eol).toBe('\n');
      expect(result.normalized).toBe('foo\n\n\nbar');
    });

    it('defaults to LF on tie or empty string', () => {
      expect(TextNormalizer.read('').eol).toBe('\n');
      expect(TextNormalizer.read('foo').eol).toBe('\n');
      expect(TextNormalizer.read('foo\r\nbar\nbaz').eol).toBe('\n'); // 1 CRLF, 1 LF
    });

    it('majority wins (CRLF)', () => {
      const result = TextNormalizer.read('a\r\nb\r\nc\r\nd\ne'); // 3 CRLF, 1 LF
      expect(result.eol).toBe('\r\n');
      expect(result.normalized).toBe('a\nb\nc\nd\ne');
    });

    it('majority wins (LF)', () => {
      const result = TextNormalizer.read('a\nb\nc\nd\r\ne'); // 1 CRLF, 3 LF
      expect(result.eol).toBe('\n');
      expect(result.normalized).toBe('a\nb\nc\nd\ne');
    });
  });

  describe('restore()', () => {
    it('restores strictly to LF when target is LF', () => {
      expect(TextNormalizer.restore('foo\nbar', '\n')).toBe('foo\nbar');
      expect(TextNormalizer.restore('foo\r\nbar', '\n')).toBe('foo\nbar');
    });

    it('restores to CRLF when target is CRLF', () => {
      expect(TextNormalizer.restore('foo\nbar', '\r\n')).toBe('foo\r\nbar');
    });

    it('does not create double carriage returns', () => {
      // Input accidentally has mixed \r\n, restoring CRLF should not make it \r\r\n
      expect(TextNormalizer.restore('foo\r\nbar\n', '\r\n')).toBe('foo\r\nbar\r\n');
    });
  });
});
