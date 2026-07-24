import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const { runVerifyMock } = (() => ({
  runVerifyMock: mock(),
}))();

mock.module('../../../../../src/core/verification/runner.js', () => ({
  runVerify: runVerifyMock,
}));

import { getGlobalAdjuster } from '../../../../../src/core/context/budget/dynamic-adjuster.js';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    options: {
      verify: 'bun test',
    },
    workspace: {
      workPath: '/repo',
    },
    contextResult: {
      context: {
        repoPath: '/repo',
        primaryFile: 'a.ts',
        primaryText: 'content',
        rgSnippets: [],
      },
      prompt: 'prompt',
      meta: {
        usedChars: 24000,
        truncated: false,
        requestedBudgetChars: 30000,
        diffScope: 'primary',
        includedFiles: ['a.ts'],
        sectionChars: {
          primary: 1000,
          relatedFiles: 0,
          rgSnippets: 0,
          diffs: 0,
          total: 1000,
        },
      },
    },
    attempt: 1,
    emit: mock(),
    ...overrides,
  };
}

describe('verify step budget status log', () => {
  beforeEach(() => {
    mock.restore();
    getGlobalAdjuster().reset();
  });

  afterEach(() => {
    getGlobalAdjuster().reset();
  });

  it('emits a budget status summary log after collecting stats', async () => {
    runVerifyMock.mockResolvedValueOnce({
      ok: true,
      output: 'ok',
      exitCode: 0,
    });

    const { runVerify } = await import('../../../../../src/core/grizzco/steps/verify.js');
    const ctx = createCtx() as any;
    await runVerify(ctx);

    expect(
      ctx.emit.mock.calls.some(
        (call: any[]) =>
          call[0]?.type === 'log' &&
          call[0]?.level === 'debug' &&
          typeof call[0]?.message === 'string' &&
          call[0].message.includes('Budget status'),
      ),
    ).toBe(true);
  });
});
