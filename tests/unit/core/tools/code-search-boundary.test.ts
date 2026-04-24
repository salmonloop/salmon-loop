import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';

import { clearLogger, createLogger, setLogger } from '../../../../src/core/observability/logger.js';
import { codeSearchExecutor } from '../../../../src/core/tools/builtin/code-search/executor.js';
import type { ExecutionPhase, ToolRuntimeCtx } from '../../../../src/core/tools/types.js';
import { text } from '../../../../src/locales/index.js';

function createAutopilotCtx(repoRoot: string): ToolRuntimeCtx & {
  phase: ExecutionPhase;
  platform: string;
  runner: { execFile: ReturnType<typeof mock> };
} {
  return {
    repoRoot,
    worktreeRoot: repoRoot,
    phase: 'AUTOPILOT',
    attemptId: 1,
    dryRun: false,
    platform: process.platform,
    runner: {
      execFile: mock(async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      })),
    },
  };
}

describe('code.search repo boundary', () => {
  beforeAll(() => {
    setLogger(createLogger({ silent: true }));
  });

  afterAll(() => {
    clearLogger();
  });

  it('rejects absolute cwd outside repo before invoking a backend', async () => {
    const ctx = createAutopilotCtx('/repo');

    await expect(
      codeSearchExecutor({ pattern: 'todo', cwd: '/', maxMatches: 100, isRegex: false }, ctx),
    ).rejects.toThrow(text.errors.pathOutsideRepo);

    expect(ctx.runner.execFile).not.toHaveBeenCalled();
  });

  it('rejects traversal cwd outside repo before invoking a backend', async () => {
    const ctx = createAutopilotCtx('/repo/app');

    await expect(
      codeSearchExecutor({ pattern: 'todo', cwd: '../..', maxMatches: 100, isRegex: false }, ctx),
    ).rejects.toThrow(text.errors.pathOutsideRepo);

    expect(ctx.runner.execFile).not.toHaveBeenCalled();
  });
});
