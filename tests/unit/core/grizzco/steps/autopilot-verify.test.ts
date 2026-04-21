import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { text } from '../../../../../src/locales/index.js';
import * as verificationRunner from '../../../../../src/core/verification/runner.js';

const hoisted = (() => ({
  runVerifyCommand: mock(),
  saveText: mock(),
}))();

mock.module('../../../../../src/core/verification/runner.js', () => ({
  ...verificationRunner,
  runVerify: hoisted.runVerifyCommand,
}));

mock.module('../../../../../src/core/sub-agent/artifacts/store.js', () => ({
  ArtifactStore: {
    saveText: hoisted.saveText,
  },
}));

describe('runAutopilotVerifyGate', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    hoisted.runVerifyCommand.mockResolvedValue({
      ok: false,
      output: 'verify failed',
      exitCode: 1,
    });
    hoisted.saveText.mockResolvedValue({
      handle: 's8p://artifact/verify-1',
      mimeType: 'text/plain',
      sha256: 'verify-1',
      size: 13,
    });
  });

  it('runs verify when autopilot mutated files and a verify command exists', async () => {
    const { runAutopilotVerifyGate } = await import(
      '../../../../../src/core/grizzco/steps/autopilot.js'
    );

    const result = await runAutopilotVerifyGate({
      mutated: true,
      options: { verify: 'bun test', signal: undefined },
      workspace: { workPath: '/repo', baseRepoPath: '/repo', strategy: 'direct' },
      emit: () => {},
    } as any);

    expect(result.verifyResult).toEqual(
      expect.objectContaining({
        ok: false,
        output: 'verify failed',
      }),
    );
  });

  it('skips verify when autopilot did not mutate the workspace', async () => {
    const { runAutopilotVerifyGate } = await import(
      '../../../../../src/core/grizzco/steps/autopilot.js'
    );

    const result = await runAutopilotVerifyGate({
      mutated: false,
      options: { verify: 'bun test', signal: undefined },
      workspace: { workPath: '/repo', baseRepoPath: '/repo', strategy: 'direct' },
      emit: () => {},
    } as any);

    expect(result.verifyResult).toBeUndefined();
    expect(hoisted.runVerifyCommand).not.toHaveBeenCalled();
  });

  it('returns a skipped verify result when no verify command is configured', async () => {
    const { runAutopilotVerifyGate } = await import(
      '../../../../../src/core/grizzco/steps/autopilot.js'
    );

    const result = await runAutopilotVerifyGate({
      mutated: true,
      options: { verify: undefined, signal: undefined },
      workspace: { workPath: '/repo', baseRepoPath: '/repo', strategy: 'direct' },
      emit: () => {},
    } as any);

    expect(result.verifyResult).toEqual({
      ok: true,
      output: text.loop.verificationSkipped,
      exitCode: null,
    });
    expect(hoisted.runVerifyCommand).not.toHaveBeenCalled();
  });
});
