import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { LIMITS } from '../../../../../src/core/config/limits.js';
import {
  clearPromptRegistry,
  createPromptRegistry,
  setPromptRegistry,
} from '../../../../../src/core/prompts/registry.js';

const hoisted = (() => ({
  chatWithTools: mock(),
  chatWithToolsStreaming: mock(),
  resolveLlmToolCallingPolicy: mock(),
  gitExecMeta: mock(),
  lstat: mock(),
  readlink: mock(),
}))();

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

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

mock.module('../../../../../src/core/adapters/fs/node-fs.js', () => ({
  lstat: hoisted.lstat,
  readlink: hoisted.readlink,
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

function readPathAfterFieldCount(record: string, fieldCount: number): string {
  let spacesSeen = 0;

  for (let index = 0; index < record.length; index += 1) {
    if (record[index] !== ' ') {
      continue;
    }

    spacesSeen += 1;
    if (spacesSeen === fieldCount) {
      return record.slice(index + 1);
    }
  }

  throw new Error(`Malformed status record fixture: ${record}`);
}

function readSpaceDelimitedField(record: string, fieldIndex: number): string {
  let fieldStart = 0;
  let currentField = 0;

  for (let index = 0; index <= record.length; index += 1) {
    const atSeparator = index === record.length || record[index] === ' ';
    if (!atSeparator) {
      continue;
    }

    if (currentField === fieldIndex) {
      return record.slice(fieldStart, index);
    }

    currentField += 1;
    fieldStart = index + 1;
  }

  throw new Error(`Malformed status record fixture: ${record}`);
}

function extractHashablePaths(records: string[]): string[] {
  const paths: string[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const kind = record[0];

    if (kind === '?') {
      paths.push(readPathAfterFieldCount(record, 1));
      continue;
    }

    if (kind === '!') {
      continue;
    }

    if (kind === '1') {
      if (readSpaceDelimitedField(record, 5) !== '000000') {
        paths.push(readPathAfterFieldCount(record, 8));
      }
      continue;
    }

    if (kind === '2') {
      if (readSpaceDelimitedField(record, 5) !== '000000') {
        paths.push(readPathAfterFieldCount(record, 9));
      }
      index += 1;
      continue;
    }

    if (kind === 'u') {
      if (readSpaceDelimitedField(record, 6) !== '000000') {
        paths.push(readPathAfterFieldCount(record, 10));
      }
      continue;
    }

    throw new Error(`Unsupported status record fixture: ${record}`);
  }

  return paths;
}

function trackedStatusRecord(
  path: string,
  overrides: Partial<{
    xy: string;
    sub: string;
    mH: string;
    mI: string;
    mW: string;
    hH: string;
    hI: string;
  }> = {},
): string {
  return [
    '1',
    overrides.xy ?? '.M',
    overrides.sub ?? 'N...',
    overrides.mH ?? '100644',
    overrides.mI ?? '100644',
    overrides.mW ?? '100644',
    overrides.hH ?? '1111111111111111111111111111111111111111',
    overrides.hI ?? '2222222222222222222222222222222222222222',
    path,
  ].join(' ');
}

function queueWorkspaceFingerprint(params: {
  head?: string;
  index?: string;
  statusRecords?: string[];
  workingHashes?: Record<string, string | null>;
}) {
  const statusRecords = [...(params.statusRecords ?? [])];
  hoisted.gitExecMeta.mockResolvedValueOnce(okGitMetaResult(`${params.head ?? 'head'}\n`));
  hoisted.gitExecMeta.mockResolvedValueOnce(okGitMetaResult(`${params.index ?? 'index'}\n`));
  hoisted.gitExecMeta.mockResolvedValueOnce(
    okGitMetaResult(statusRecords.length > 0 ? `${statusRecords.join('\0')}\0` : ''),
  );

  for (const path of extractHashablePaths(statusRecords)) {
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
    setPromptRegistry(createPromptRegistry());
    hoisted.resolveLlmToolCallingPolicy.mockReturnValue({ enabled: true, maxRounds: 8 });
    hoisted.gitExecMeta.mockImplementation(async () => {
      throw new Error('Unexpected git execMeta call');
    });
    hoisted.lstat.mockResolvedValue({
      isSymbolicLink: () => false,
    });
    hoisted.readlink.mockImplementation(async () => {
      throw new Error('Unexpected readlink call');
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

  afterEach(() => {
    clearPromptRegistry();
  });

  it('marks the workspace as mutated when tool execution changes workspace status', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    queueWorkspaceFingerprint({ statusRecords: [] });
    queueWorkspaceFingerprint({
      statusRecords: [trackedStatusRecord('src/core/tools/builtin/shell.ts')],
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
    const systemPrompt = hoisted.chatWithTools.mock.calls[0]?.[0]?.[0]?.content;
    expect(systemPrompt).toContain('Treat simple repo-relative paths like "smoke.txt"');
    expect(systemPrompt).toContain('Do not ask the user to validate a path');
    expect(systemPrompt).toContain('"questions"');
    expect(systemPrompt).toContain('"options"');
    expect(result.report.summary).toBe('autopilot with tools');
    expect(result.mutated).toBe(true);
    expect(result.changedFiles).toEqual(['src/core/tools/builtin/shell.ts']);
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

  it('injects relevant memory into the real autopilot request path', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    queueWorkspaceFingerprint({ statusRecords: [] });
    queueWorkspaceFingerprint({ statusRecords: [] });

    const llm = {
      chat: mock(async () => ({ role: 'assistant', content: 'fallback' })),
      getModelId: () => 'gpt-test',
    } as any;

    await runAutopilot({
      context: {
        repoPath: '/repo',
        instruction: 'create smoke.txt with autopilot smoke',
        contextHash: 'ctx-autopilot',
        rgSnippets: [],
        knowledgeBase: {
          project_rules: ['Prefer direct file creation for smoke tasks.'],
        },
      },
      options: {
        instruction: 'create smoke.txt with autopilot smoke',
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

    const firstCallMessages = hoisted.chatWithTools.mock.calls.at(-1)?.[0];
    expect(firstCallMessages.at(-1)?.content).toContain('[Relevant memory]');
    expect(firstCallMessages.at(-1)?.content).toContain(
      'Prefer direct file creation for smoke tasks.',
    );
  });

  it('keeps mutated false when workspace status is unchanged after tool execution', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    queueWorkspaceFingerprint({ statusRecords: [] });
    queueWorkspaceFingerprint({ statusRecords: [] });
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
    expect(result.changedFiles).toBeUndefined();
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
      statusRecords: [trackedStatusRecord('src/app.ts')],
      workingHashes: { 'src/app.ts': 'before-dirty-hash' },
    });
    queueWorkspaceFingerprint({
      statusRecords: [trackedStatusRecord('src/app.ts')],
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
    expect(result.changedFiles).toEqual(['src/app.ts']);
    expect(result.toolCallingAudit).toHaveLength(2);
    expect(result.toolCallingAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callId: 'existing-call', toolName: 'fs.read' }),
        expect.objectContaining({ toolName: 'shell.exec', toolIntent: 'INFRA' }),
      ]),
    );
  });

  it('marks the workspace as mutated when only status metadata changes for an already-dirty path', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    const statusOutputs = [
      `${trackedStatusRecord('script.sh')}\0`,
      `${trackedStatusRecord('script.sh', { mW: '100755' })}\0`,
    ];
    let hashCalls = 0;
    let statusCalls = 0;

    hoisted.gitExecMeta.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return okGitMetaResult('head\n');
      }
      if (args[0] === 'write-tree') {
        return okGitMetaResult('index\n');
      }
      if (args[0] === 'status' && args[1] === '--porcelain=v2') {
        const output = statusOutputs[statusCalls] ?? statusOutputs[statusOutputs.length - 1] ?? '';
        statusCalls += 1;
        return okGitMetaResult(output);
      }
      if (args[0] === 'hash-object') {
        hashCalls += 1;
        return okGitMetaResult('same-content-hash\n');
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

    expect(result.mutated).toBe(true);
    expect(result.changedFiles).toEqual(['script.sh']);
    expect(hashCalls).toBeGreaterThan(0);
    expect(statusCalls).toBe(2);
  });

  it('reports deleted tracked paths in changedFiles when autopilot removes a clean file', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    const statusOutputs = [
      '',
      `${trackedStatusRecord('src/deleted.ts', { xy: '.D', mW: '000000' })}\0`,
    ];

    hoisted.gitExecMeta.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return okGitMetaResult('head\n');
      }
      if (args[0] === 'write-tree') {
        return okGitMetaResult('index\n');
      }
      if (args[0] === 'status' && args[1] === '--porcelain=v2') {
        return okGitMetaResult(statusOutputs.shift() ?? '');
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

    expect(result.mutated).toBe(true);
    expect(result.changedFiles).toEqual(['src/deleted.ts']);
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
    expect(result.changedFiles).toBeUndefined();
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
    const statusOutputs = [
      `${trackedStatusRecord(' leading and trailing .ts ')}\0`,
      `${trackedStatusRecord(' leading and trailing .ts ')}\0`,
    ];

    hoisted.gitExecMeta.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return okGitMetaResult('head\n');
      }
      if (args[0] === 'write-tree') {
        return okGitMetaResult('index\n');
      }
      if (args[0] === 'status' && args[1] === '--porcelain=v2') {
        return okGitMetaResult(statusOutputs.shift() ?? '');
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
    expect(result.changedFiles).toBeUndefined();
    expect(hashedPaths).toEqual([' leading and trailing .ts ', ' leading and trailing .ts ']);
  });

  it('hashes dirty workspace entries serially', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');
    const statusOutputs = [
      `${trackedStatusRecord('a.txt')}\0${trackedStatusRecord('b.txt')}\0`,
      '',
    ];
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
      if (args[0] === 'status' && args[1] === '--porcelain=v2') {
        return Promise.resolve(okGitMetaResult(statusOutputs.shift() ?? ''));
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

    await waitFor(() => hashStartOrder.length > 0);

    expect(hashStartOrder).toEqual(['a.txt']);

    firstHashResolved = true;
    resolveFirstHash?.(okGitMetaResult('hash-a\n'));

    const result = await runPromise;

    expect(result.mutated).toBe(true);
    expect(result.changedFiles).toEqual(['a.txt', 'b.txt']);
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
    expect(result.changedFiles).toBeUndefined();
  });
});
