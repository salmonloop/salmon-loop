import { describe, it, expect, beforeEach } from 'vitest';

import { StrataContentGuardian } from '../../../../src/core/strata/interaction/content-guardian.js';

describe('StrataContentGuardian (Shadow Verification)', () => {
  let guardian: StrataContentGuardian;

  beforeEach(() => {
    guardian = new StrataContentGuardian();
  });

  describe('Legacy Behavior: Binary Detection', () => {
    // Legacy Logic: Scan for null bytes
    it('should identify binary files by null bytes (simulating old behavior)', () => {
      const binaryBuffer = Buffer.from('Hello\0World');
      const result = guardian.inspect(binaryBuffer);
      expect(result.isBinary).toBe(true);
      expect(result.normalized).toBe('');
      // Legacy behavior returned true on first null byte
    });

    it('should identify text files correctly', () => {
      const textBuffer = Buffer.from('Hello World');
      const result = guardian.inspect(textBuffer);
      expect(result.isBinary).toBe(false);
      expect(result.normalized).toBe('Hello World');
    });

    // Optimization Check
    it('should respect Git-style binary check limits (8KB)', () => {
      // Create a large buffer with null byte AFTER the check limit
      const largeBuffer = Buffer.alloc(10000).fill('a');
      largeBuffer[9000] = 0; // Null byte far down

      const result = guardian.inspect(largeBuffer);
      // It should be treated as text because the null byte is outside the check window
      // This is an OPTIMIZATION over the legacy full-scan behavior
      expect(result.isBinary).toBe(false);
    });
  });

  describe('Legacy Behavior: EOL Normalization', () => {
    // Legacy Logic: TextNormalizer.read -> normalize -> restore
    it('should detect CRLF and normalize to LF', () => {
      const crlfContent = Buffer.from('Line1\r\nLine2\r\n');
      const result = guardian.inspect(crlfContent);

      expect(result.eol).toBe('\r\n');
      expect(result.normalized).toBe('Line1\nLine2\n');
    });

    it('should detect LF and keep as LF', () => {
      const lfContent = Buffer.from('Line1\nLine2\n');
      const result = guardian.inspect(lfContent);

      expect(result.eol).toBe('\n');
      expect(result.normalized).toBe('Line1\nLine2\n');
    });

    it('should restore content to original EOL (CRLF)', () => {
      const normalized = 'Line1\nLine2\n';
      const restored = guardian.restore(normalized, '\r\n');

      expect(restored.toString()).toBe('Line1\r\nLine2\r\n');
    });

    it('should restore content to original EOL (LF)', () => {
      const normalized = 'Line1\nLine2\n';
      const restored = guardian.restore(normalized, '\n');

      expect(restored.toString()).toBe('Line1\nLine2\n');
    });
  });
});
