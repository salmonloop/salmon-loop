import { describe, expect, it, mock } from 'bun:test';

import {
  isSalvageablePatchError,
  salvagePatchDiff,
} from '../../../../../../src/core/grizzco/steps/patch/diff-salvage.js';

describe('patch/diff-salvage', () => {
  it('detects salvageable patch errors by llmCode', () => {
    expect(isSalvageablePatchError({ llmCode: 'LLM_PATCH_EMPTY' })).toBe(true);
    expect(isSalvageablePatchError({ llmCode: 'LLM_PATCH_NOT_UNIFIED_DIFF' })).toBe(true);
    expect(isSalvageablePatchError({ llmCode: 'OTHER' })).toBe(false);
  });

  it('repairs content once and returns validated patch payload', async () => {
    const onAttempt = mock();
    const onResult = mock();

    const out = await salvagePatchDiff({
      initialError: { llmCode: 'LLM_PATCH_EMPTY', message: 'empty' },
      rawContent: '',
      plannedFiles: ['src/index.ts'],
      repair: async () => ({
        content: [
          'diff --git a/src/index.ts b/src/index.ts',
          '--- a/src/index.ts',
          '+++ b/src/index.ts',
          '@@ -1,1 +1,1 @@',
          '-const x = 1;',
          '+const x = 2;',
          '',
        ].join('\n'),
      }),
      onAttempt,
      onResult,
    });

    expect(out).toBeTruthy();
    expect(out?.diffMeta.changedFiles).toEqual(['src/index.ts']);
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ ok: true, contentLength: expect.any(Number) });
  });

  it('returns null for non-salvageable errors', async () => {
    const out = await salvagePatchDiff({
      initialError: new Error('not salvageable'),
      rawContent: 'x',
      plannedFiles: ['src/index.ts'],
      repair: async () => ({ content: 'ignored' }),
    });

    expect(out).toBeNull();
  });
});
