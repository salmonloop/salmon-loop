import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { LIMITS } from '../../../../../src/core/config/limits.js';

const hoisted = (() => ({
  chatWithTools: mock(),
  chatWithToolsStreaming: mock(),
  resolveLlmToolCallingPolicy: mock(),
  gitExecMeta: mock(),
}))();

mock.module('../../../../../src/core/tools/session.js', () => ({
  chatWithTools: hoisted.chatWithTools,
  chatWithToolsStreaming: hoisted.chatWithToolsStreaming,
}));

mock.module('../../../../../src/core/grizzco/dsl/llm-strategy.js', () => ({
  resolveLlmToolCallingPolicy: hoisted.resolveLlmToolCallingPolicy,
}));

mock.module('../../../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: class {
    constructor(_repoPath: string) {}

    execMeta = hoisted.gitExecMeta;
  },
}));

function okGitMetaResult(
  stdout: string,
  overrides: Partial<{
    ok: boolean;
    code: number | null;
    stderr: string;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    error: { code?: string; message: string };
  }> = {},
) {
  return {
    ok: true,
    code: 0,
    signal: null,
    stdout: Buffer.from(stdout, 'utf8'),
    stderr: '',
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

function queueWorkspaceFingerprint(params: {
  head?: string;
  index?: string;
  workingPaths?: string[];
  deletedPaths?: string[];
  workingHashes?: Record<string, string | null>;
}) {
  const workingPaths = [...(params.workingPaths ?? [])];
  const deletedPaths = [...(params.deletedPaths ?? [])];
  hoisted.gitExecMeta.mockResolvedValueOnce(okGitMetaResult(`${params.head ?? 'head'}\n`));
  hoisted.gitExecMeta.mockResolvedValueOnce(okGitMetaResult(`${params.index ?? 'index'}\n`));
  hoisted.gitExecMeta.mockResolvedValueOnce(okGitMetaResult(workingPaths.join('\0')));
  hoisted.gitExecMeta.mockResolvedValueOnce(okGitMetaResult(deletedPaths.join('\0')));

  for (const path of workingPaths) {
    const hash = params.workingHashes?.[path] ?? `${path}-hash`;
    if (hash === null) {
      hoisted.gitExecMeta.mockResolvedValueOnce(
        okGitMetaResult('', {
          ok: false,
          code: 128,
          stderr: `missing ${path}`,
        }),
      );
      continue;
    }
    hoisted.gitExecMeta.mockResolvedValueOnce(okGitMetaResult(`${hash}\n`));
  }
}

describe('runAutopilot', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    hoisted.resolveLlmToolCallingPolicy.mockReturnValue({ enabled: true, maxRounds: 8 });
    hoisted.gitExecMeta.mockImplementation(async () => {
      throw new Error('Unexpected git execMeta call');
    });
    hoisted.chatWithTools.mockImplementation(
      async (_messages: any, _chatOptions: any, session: any) => {
        session.toolCallingAudit?.event({
          timestamp: new Date().toISOString(),
          phase: 'AUTOPILOT',
          round: 0,
          callId: 'call-1',
          toolName: 'shell.exec',
          toolIntent: 'INFRA',
          rawArgsType: 'string',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
        });
        return { role: 'assistant', content: 'autopilot with tools' };
      },
    );
    hoisted.chatWithToolsStreaming.mockImplementation(
      async (_messages: any, _chatOptions: any, session: any) => {
        session.toolCallingAudit?.event({
          timestamp: new Date().toISOString(),
          phase: 'AUTOPILOT',
          round: 0,
          callId: 'call-stream',
          toolName: 'shell.exec',
          toolIntent: 'INFRA',
          rawArgsType: 'string',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
        });
        return { role: 'assistant', content: 'autopilot with streaming tools' };
      },
    );
  });

  it('marks the workspace as mutated when tool execution changes workspace status', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    queueWorkspaceFingerprint({ workingPaths: [] });
    queueWorkspaceFingerprint({
      workingPaths: ['src/core/tools/builtin/shell.ts'],
      workingHashes: { 'src/core/tools/builtin/shell.ts': 'shell-after' },
    });

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
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'worktree',
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

    expect(hoisted.chatWithTools).toHaveBeenCalledTimes(1);
    expect(hoisted.chatWithTools.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        phase: 'AUTOPILOT',
        maxRounds: 8,
      }),
    );
    expect(result.report.summary).toBe('autopilot with tools');
    expect(result.mutated).toBe(true);
    expect(result.toolCallingAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'shell.exec',
          toolIntent: 'INFRA',
          toolResultStatus: 'ok',
        }),
      ]),
    );
  });

  it('keeps mutated false when workspace status is unchanged after tool execution', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    queueWorkspaceFingerprint({ workingPaths: [] });
    queueWorkspaceFingerprint({ workingPaths: [] });
    hoisted.chatWithTools.mockImplementationOnce(
      async (_messages: any, _chatOptions: any, session: any) => {
        session.toolCallingAudit?.event({
          timestamp: new Date().toISOString(),
          phase: 'AUTOPILOT',
          round: 0,
          callId: 'call-no-change',
          toolName: 'plan.update',
          toolIntent: 'WRITE',
          rawArgsType: 'string',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
        });
        return { role: 'assistant', content: 'no workspace change' };
      },
    );

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
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'worktree',
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

    expect(result.report.summary).toBe('no workspace change');
    expect(result.mutated).toBe(false);
    expect(result.toolCallingAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'plan.update',
          toolIntent: 'WRITE',
          toolResultStatus: 'ok',
        }),
      ]),
    );
  });

  it('marks the workspace as mutated when an already-dirty path changes again', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    queueWorkspaceFingerprint({
      workingPaths: ['src/app.ts'],
      workingHashes: { 'src/app.ts': 'before-dirty-hash' },
    });
    queueWorkspaceFingerprint({
      workingPaths: ['src/app.ts'],
      workingHashes: { 'src/app.ts': 'after-dirty-hash' },
    });

    const llm = {
      chat: mock(async () => ({ role: 'assistant', content: 'fallback' })),
      getModelId: () => 'gpt-test',
    } as any;

    const existingAuditEntry = {
      timestamp: new Date().toISOString(),
      phase: 'AUTOPILOT',
      round: 0,
      callId: 'existing-call',
      toolName: 'fs.read',
      toolIntent: 'READ',
      rawArgsType: 'string',
      parsedArgsOk: true,
      toolResultStatus: 'ok',
    };

    const result = await runAutopilot({
      options: {
        instruction: 'inspect the repo and act',
        llm,
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
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
      toolCallingAudit: [existingAuditEntry],
    } as any);

    expect(result.mutated).toBe(true);
    expect(result.toolCallingAudit).toHaveLength(2);
    expect(result.toolCallingAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callId: 'existing-call', toolName: 'fs.read' }),
        expect.objectContaining({ toolName: 'shell.exec', toolIntent: 'INFRA' }),
      ]),
    );
  });

  it('fails closed when bounded workspace sampling truncates stdout', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    hoisted.gitExecMeta.mockResolvedValueOnce(okGitMetaResult('head\n'));
    hoisted.gitExecMeta.mockResolvedValueOnce(okGitMetaResult('index\n'));
    hoisted.gitExecMeta.mockResolvedValueOnce(
      okGitMetaResult('src/app.ts\0', {
        stdoutTruncated: true,
      }),
    );

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
        baseRepoPath: '/repo',
        workPath: '/repo',
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

    expect(result.report.summary).toBe('autopilot with tools');
    expect(result.mutated).toBe(true);
    expect(hoisted.gitExecMeta).toHaveBeenCalled();
    expect(hoisted.gitExecMeta.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        cwd: '/repo',
        timeoutMs: LIMITS.gitTimeoutMs,
        limits: {
          maxStdoutBytes: LIMITS.maxToolOutputBytes,
          maxStderrChars: 16_384,
        },
      }),
    );
  });

  it('preserves whitespace-sensitive dirty paths when hashing workspace entries', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    const hashedPaths: string[] = [];
    const modifiedOutputs = [' leading and trailing .ts \0', ' leading and trailing .ts \0'];
    const deletedOutputs = ['', ''];

    hoisted.gitExecMeta.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return okGitMetaResult('head\n');
      }
      if (args[0] === 'write-tree') {
        return okGitMetaResult('index\n');
      }
      if (args[0] === 'ls-files' && args.includes('--modified')) {
        return okGitMetaResult(modifiedOutputs.shift() ?? '');
      }
      if (args[0] === 'ls-files' && args.includes('--deleted')) {
        return okGitMetaResult(deletedOutputs.shift() ?? '');
      }
      if (args[0] === 'hash-object') {
        hashedPaths.push(args[3] ?? '');
        return okGitMetaResult('same-hash\n');
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

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
        baseRepoPath: '/repo',
        workPath: '/repo',
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

    expect(result.mutated).toBe(false);
    expect(hashedPaths).toEqual([' leading and trailing .ts ', ' leading and trailing .ts ']);
  });

  it('hashes dirty workspace entries serially', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    const modifiedOutputs = ['a.txt\0b.txt\0', ''];
    const deletedOutputs = ['', ''];
    const hashStartOrder: string[] = [];
    let revParseCalls = 0;
    let writeTreeCalls = 0;
    let firstHashResolved = false;
    let resolveFirstHash: ((value: ReturnType<typeof okGitMetaResult>) => void) | undefined;
    const firstHashPromise = new Promise<ReturnType<typeof okGitMetaResult>>((resolve) => {
      resolveFirstHash = resolve;
    });

    hoisted.gitExecMeta.mockImplementation((args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        revParseCalls += 1;
        return Promise.resolve(okGitMetaResult(`head-${revParseCalls}\n`));
      }
      if (args[0] === 'write-tree') {
        writeTreeCalls += 1;
        return Promise.resolve(okGitMetaResult(`index-${writeTreeCalls}\n`));
      }
      if (args[0] === 'ls-files' && args.includes('--modified')) {
        return Promise.resolve(okGitMetaResult(modifiedOutputs.shift() ?? ''));
      }
      if (args[0] === 'ls-files' && args.includes('--deleted')) {
        return Promise.resolve(okGitMetaResult(deletedOutputs.shift() ?? ''));
      }
      if (args[0] === 'hash-object' && args[3] === 'a.txt') {
        hashStartOrder.push('a.txt');
        return firstHashPromise;
      }
      if (args[0] === 'hash-object' && args[3] === 'b.txt') {
        if (!firstHashResolved) {
          hashStartOrder.push('b.txt-before-first-resolved');
        } else {
          hashStartOrder.push('b.txt');
        }
        return Promise.resolve(okGitMetaResult('hash-b\n'));
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

    const llm = {
      chat: mock(async () => ({ role: 'assistant', content: 'fallback' })),
      getModelId: () => 'gpt-test',
    } as any;

    const runPromise = runAutopilot({
      options: {
        instruction: 'inspect the repo and act',
        llm,
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
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

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hashStartOrder).toEqual(['a.txt']);

    firstHashResolved = true;
    resolveFirstHash?.(okGitMetaResult('hash-a\n'));

    const result = await runPromise;

    expect(result.mutated).toBe(true);
    expect(hashStartOrder).toEqual(['a.txt', 'b.txt']);
  });

  it('falls back to plain llm chat when tool calling is unavailable', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');

    hoisted.resolveLlmToolCallingPolicy.mockReturnValueOnce({ enabled: false, maxRounds: 4 });

    const llm = {
      chat: mock(async () => ({ role: 'assistant', content: 'fallback answer' })),
      getModelId: () => 'gpt-test',
    } as any;

    const emit = mock();
    const result = await runAutopilot({
      options: {
        instruction: 'inspect the repo and act',
        llm,
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'direct',
      },
      emit,
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
    } as any);

    expect(hoisted.chatWithTools).not.toHaveBeenCalled();
    expect(result.report.summary).toBe('fallback answer');
    expect(result.mutated).toBe(false);
  });
});
