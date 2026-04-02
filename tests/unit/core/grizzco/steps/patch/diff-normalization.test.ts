import { describe, expect, it } from 'bun:test';

import {
  extractAndValidatePatch,
  rewriteUniqueBasenameDiffPaths,
} from '../../../../../../src/core/grizzco/steps/patch/diff-normalization.js';

describe('patch/diff-normalization', () => {
  it('rewrites unique basename diff paths to planned repo-relative paths', () => {
    const rewritten = rewriteUniqueBasenameDiffPaths(
      [
        'diff --git a/build-utils.js b/build-utils.js',
        '--- a/build-utils.js',
        '+++ b/build-utils.js',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
        '',
      ].join('\n'),
      ['scripts/build-utils.js'],
    );

    expect(rewritten).toContain('diff --git a/scripts/build-utils.js b/scripts/build-utils.js');
    expect(rewritten).toContain('--- a/scripts/build-utils.js');
    expect(rewritten).toContain('+++ b/scripts/build-utils.js');
  });

  it('extracts and validates canonical unified diffs', () => {
    const out = extractAndValidatePatch({
      rawContent: [
        'diff --git a/src/index.ts b/src/index.ts',
        '--- a/src/index.ts',
        '+++ b/src/index.ts',
        '@@ -1,1 +1,1 @@',
        '-const x = 1;',
        '+const x = 2;',
        '',
      ].join('\n'),
      plannedFiles: ['src/index.ts'],
    });

    expect(out.patch.startsWith('diff --git a/src/index.ts b/src/index.ts')).toBe(true);
    expect(out.diffMeta.changedFiles).toEqual(['src/index.ts']);
    expect(out.normalizedPatch.endsWith('\n')).toBe(true);
  });

  it('fails closed with patch-specific llm error when no canonical diff exists', () => {
    expect(() =>
      extractAndValidatePatch({
        rawContent: [
          '--- a/src/index.ts',
          '+++ b/src/index.ts',
          '@@ -1,1 +1,1 @@',
          '-const x = 1;',
          '+const x = 2;',
          '',
        ].join('\n'),
        plannedFiles: ['src/index.ts'],
      }),
    ).toThrow(expect.objectContaining({ llmCode: 'LLM_PATCH_NOT_UNIFIED_DIFF' }));
  });
});
