import { readlink, symlink, unlink } from 'fs/promises';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

const hoisted = (() => ({
  chatWithTools: mock(),
  chatWithToolsStreaming: mock(),
  resolveLlmToolCallingPolicy: mock(),
}))();

mock.module('../../src/core/tools/session.js', () => ({
  chatWithTools: hoisted.chatWithTools,
  chatWithToolsStreaming: hoisted.chatWithToolsStreaming,
}));

mock.module('../../src/core/grizzco/dsl/llm-strategy.js', () => ({
  resolveLlmToolCallingPolicy: hoisted.resolveLlmToolCallingPolicy,
}));

describe('runAutopilot workspace mutation sampling (integration)', () => {
  const helper = new RealFsTestHelper();
  let activeRepoPath = '';

  beforeEach(() => {
    mock.clearAllMocks();
    activeRepoPath = '';
    hoisted.resolveLlmToolCallingPolicy.mockReturnValue({ enabled: true, maxRounds: 8 });
    hoisted.chatWithToolsStreaming.mockImplementation(async () => {
      throw new Error('streaming tools are not used in this test');
    });
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('marks the workspace as mutated when an already-dirty symlink target changes again', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const repo = await helper.createGitRepo({ createInitialCommit: false });
    activeRepoPath = repo.path;

    await helper.writeFile(repo.path, 'target1.txt', 'original target\n');
    await helper.writeFile(repo.path, 'target2.txt', 'same payload\n');
    await helper.writeFile(repo.path, 'target3.txt', 'same payload\n');
    await symlink('target1.txt', join(repo.path, 'link'));
    await helper.createCommit(repo.path, 'initial repo', [
      'target1.txt',
      'target2.txt',
      'target3.txt',
      'link',
    ]);

    await unlink(join(repo.path, 'link'));
    await symlink('target2.txt', join(repo.path, 'link'));

    hoisted.chatWithTools.mockImplementationOnce(async (_messages: any, _chatOptions: any, session: any) => {
      await unlink(join(activeRepoPath, 'link'));
      await symlink('target3.txt', join(activeRepoPath, 'link'));
      session.toolCallingAudit?.event({
        timestamp: new Date().toISOString(),
        phase: 'AUTOPILOT',
        round: 0,
        callId: 'call-symlink',
        toolName: 'shell.exec',
        toolIntent: 'INFRA',
        rawArgsType: 'string',
        parsedArgsOk: true,
        toolResultStatus: 'ok',
      });
      return { role: 'assistant', content: 'updated symlink target' };
    });

    const { runAutopilot } = await import('../../src/core/grizzco/steps/autopilot.js');
    const llm = {
      chat: mock(async () => ({ role: 'assistant', content: 'fallback' })),
      getModelId: () => 'gpt-test',
    } as any;

    const result = await runAutopilot({
      options: {
        instruction: 'inspect the repo and act',
        llm,
      },
      workspace: {
        baseRepoPath: repo.path,
        workPath: repo.path,
        strategy: 'direct',
      },
      toolstack: {
        registry: { listAll: () => [] },
        policy: { decide: () => ({ allowed: true }) },
        router: {},
      },
      emit: () => {},
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
      artifactHints: {},
      toolCallingAudit: [],
    } as any);

    expect(await readlink(join(repo.path, 'link'))).toBe('target3.txt');
    expect(result.mutated).toBe(true);
  });
});
