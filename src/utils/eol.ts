export type EOL = '\n' | '\r\n';

export class TextNormalizer {
  /**
   * Auto-detect and normalize line endings to LF (\n).
   * @param content The text content to normalize
   * @returns normalized: Content with only LF, eol: The detected dominant EOL style
   */
  static read(content: string): { normalized: string; eol: EOL } {
    // 1. Count frequencies to handle mixed line endings
    const crlfCount = (content.match(/\r\n/g) || []).length;
    const lfCount = (content.match(/(?<!\r)\n/g) || []).length;

    // 2. Determine style (default to LF if LF >= CRLF)
    const eol: EOL = crlfCount > lfCount ? '\r\n' : '\n';

    // 3. Normalize to LF
    const normalized = content.replace(/\r\n/g, '\n');

    return { normalized, eol };
  }

  /**
   * Restore line endings to the target style.
   * @param content The content (usually LF)
   * @param targetEOL The target EOL style
   * @returns Content with target EOL
   */
  static restore(content: string, targetEOL: EOL): string {
    if (targetEOL === '\n') {
      // Just ensure no CRLF mixed in (keep strictly LF)
      return content.replace(/\r\n/g, '\n');
    } else {
      // Target is CRLF: First normalize to LF, then convert to CRLF
      // This prevents \r\r\n if the input already had some CRLF
      return content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    }
  }
}
