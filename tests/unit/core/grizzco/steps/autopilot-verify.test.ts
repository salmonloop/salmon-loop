import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { ArtifactStore } from '../../../../../src/core/sub-agent/artifacts/store.js';
import * as verificationRunner from '../../../../../src/core/verification/runner.js';

describe('runAutopilotVerifyGate', () => {
  beforeEach(() => {
    mock.restore();
    spyOn(verificationRunner, 'runVerify').mockResolvedValue({
      ok: false,
      output: 'verify failed',
      exitCode: 1,
    });
    spyOn(ArtifactStore, 'saveText').mockResolvedValue({
      handle: 's8p://artifact/verify-1',
      mimeType: 'text/plain',
      sha256: 'verify-1',
      size: 13,
    });
  });

  it('runs verify when autopilot mutated files and a verify command exists', async () => {
    const { runAutopilotVerifyGate } =
      await import('../../../../../src/core/grizzco/steps/autopilot.js');

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
    const { runAutopilotVerifyGate } =
      await import('../../../../../src/core/grizzco/steps/autopilot.js');

    const result = await runAutopilotVerifyGate({
      mutated: false,
      options: { verify: 'bun test', signal: undefined },
      workspace: { workPath: '/repo', baseRepoPath: '/repo', strategy: 'direct' },
      emit: () => {},
    } as any);

    expect(result.verifyResult).toBeUndefined();
    expect(verificationRunner.runVerify).not.toHaveBeenCalled();
  });

  it('skips verify gate when no verify command is configured (LLM-driven autopilot)', async () => {
    const { runAutopilotVerifyGate } =
      await import('../../../../../src/core/grizzco/steps/autopilot.js');

    const result = await runAutopilotVerifyGate({
      mutated: true,
      options: { verify: undefined, signal: undefined },
      workspace: { workPath: '/repo', baseRepoPath: '/repo', strategy: 'direct' },
      emit: () => {},
    } as any);

    expect(result.verifyResult).toBeUndefined();
    expect(result.completion).toBeUndefined();
    expect(verificationRunner.runVerify).not.toHaveBeenCalled();
  });

  it('returns ok=true when verify passes', async () => {
    (verificationRunner.runVerify as ReturnType<typeof mock>).mockResolvedValue({
      ok: true,
      output: 'all tests passed',
      exitCode: 0,
    });

    const { runAutopilotVerifyGate } =
      await import('../../../../../src/core/grizzco/steps/autopilot.js');

    const result = await runAutopilotVerifyGate({
      mutated: true,
      options: { verify: 'bun test', signal: undefined },
      workspace: { workPath: '/repo', baseRepoPath: '/repo', strategy: 'direct' },
      emit: () => {},
    } as any);

    expect(result.verifyResult).toEqual(
      expect.objectContaining({
        ok: true,
        output: 'all tests passed',
      }),
    );
  });
});
