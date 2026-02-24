import { describe, expect, it } from 'bun:test';

import { extractKeywords } from '../../../src/core/context/keywords.js';

describe('extractKeywords', () => {
  it('prioritizes path-like tokens', () => {
    const keywords = extractKeywords(
      'Please update src/core/context/service.ts to include targets',
    );
    expect(keywords[0]).toBe('src/core/context/service.ts');
  });

  it('captures backticked identifiers and error-like tokens', () => {
    const keywords = extractKeywords('Fix `packUntilFull` when it throws TypeError in edge cases');
    expect(keywords).toContain('packUntilFull');
    expect(keywords).toContain('TypeError');
  });

  it('falls back to CJK ngrams for short non-tokenized instructions', () => {
    const keywords = extractKeywords('修复上下文预算截断问题');
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords[0]!.length).toBeGreaterThanOrEqual(2);
  });
});
