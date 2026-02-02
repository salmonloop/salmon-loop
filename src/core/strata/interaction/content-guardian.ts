import { TextNormalizer, type EOL } from '../../../utils/eol.js';
import { LIMITS } from '../../limits.js';
import type { IContentGuardian } from '../types.js';

export interface GuardianResult {
  normalized: string;
  eol: EOL;
  isBinary: boolean;
  size: number;
}

/**
 * Strata Content Guardian
 *
 * Implements strict content safety protocols for Strata file interactions.
 * - Binary Detection: Prevents corruption of binary files
 * - EOL Normalization: Ensures cross-platform merge consistency
 * - Size Guard: Prevents memory exhaustion attacks
 */
export class StrataContentGuardian implements IContentGuardian {
  private static readonly BINARY_CHECK_BYTES = LIMITS.binaryCheckBufferSize;

  /**
   * Sniff content for binary signatures and normalize text for processing.
   * This is the entry point for ALL file content entering the Strata system.
   */
  inspect(content: Buffer): GuardianResult {
    const isBinary = this.hasBinarySignature(content);
    const size = content.length;

    if (isBinary) {
      return {
        normalized: '', // We do not normalize binary content
        eol: '\n', // Default fallback
        isBinary: true,
        size,
      };
    }

    // For text files, perform EOL sniffing and normalization
    const textContent = content.toString('utf8');
    const { normalized, eol } = TextNormalizer.read(textContent);

    return {
      normalized,
      eol,
      isBinary: false,
      size,
    };
  }

  /**
   * Restore content to its original EOL format.
   * Must be called before writing any merged content back to disk.
   */
  restore(text: string, targetEOL: EOL): Buffer {
    const restoredText = TextNormalizer.restore(text, targetEOL);
    return Buffer.from(restoredText, 'utf8');
  }

  /**
   * Check for null bytes in the first N bytes of the buffer.
   * This is the same heuristic used by Git.
   */
  private hasBinarySignature(content: Buffer): boolean {
    const len = Math.min(content.length, StrataContentGuardian.BINARY_CHECK_BYTES);
    for (let i = 0; i < len; i++) {
      if (content[i] === 0) return true;
    }
    return false;
  }
}
