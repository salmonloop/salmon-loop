import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { clearLogger, setLogger } from '../../../src/core/observability/logger.js';

const loopExecuteMock = mock(async (_initCtx: any) => ({
  agent_ref: 'surgeon',
  success: true,
  summary: 'ok',
  tokenUsage: 0,
  attempts: 1,
  logs: [],
}));

mock.module('../../../src/core/sub-agent/core/loop.js', () => ({
  SmallfryLoop: class {
    constructor(_profile: unknown) {}

    execute(initCtx: any) {
      return loopExecuteMock(initCtx);
    }
  },
}));

describe('SubAgentManager read-only phase guard', () => {
  beforeEach(() => {
    setLogger({
      info: mock(),
      debug: mock(),
      error: mock(),
      warn: mock(),
    } as any);
  });

  afterAll(() => {
    clearLogger();
  });

  it('forces dryRun=true when dispatch is triggered in PLAN phase', async () => {
    const { SubAgentManager } = await import('../../../src/core/sub-agent/core/manager.js');

    const setup = mock(async () => undefined);
    const teardown = mock(async () => undefined);
    const createRuntimeEnvironment = mock((options: any) => ({
      setup,
      teardown,
      workspace: {
        workPath: '/repo-shadow',
        baseRepoPath: '/repo',
        strategy: 'worktree',
      },
      initialSnapshotHash: 'shadow-head',
      _options: options,
    }));

    const manager = new SubAgentManager(
      {
        repoRoot: '/repo',
        persistenceRoot: '/repo',
        dryRun: false,
        phase: 'PLAN',
        llm: {
          chat: mock(),
          createPlan: mock(),
          createPatch: mock(),
        },
      } as any,
      {
        registerAgent: mock(),
        isStopRequested: mock(() => false),
        appendLog: mock(),
        updateStatus: mock(),
        listAgents: mock(() => []),
        getAgent: mock(() => undefined),
        tailLogs: mock(() => []),
        requestStop: mock(() => true),
      } as any,
      {
        registry: {
          get: mock(() => ({
            id: 'surgeon',
            name: 'Surgeon',
            role: 'Coder',
            description: 'test',
            allowedTools: ['fs.read'],
            readOnly: false,
            stratagem: 'surgeon',
            timeoutMs: 1000,
          })),
        },
        createRuntimeEnvironment,
        artifactStore: {
          saveText: mock(),
        },
      } as any,
    );

    await manager.execute({
      agent_ref: 'surgeon',
      task: 'analyze safely',
      session_target: 'isolated',
    });

    const runtimeOptions = createRuntimeEnvironment.mock.calls[0]?.[0];
    expect(runtimeOptions).toBeTruthy();
    expect(runtimeOptions.dryRun).toBe(true);
    const initCtx = loopExecuteMock.mock.calls[0]?.[0];
    expect(initCtx?.options?.dryRun).toBe(true);
  });

  it('keeps runtime dryRun setting in VERIFY phase', async () => {
    const { SubAgentManager } = await import('../../../src/core/sub-agent/core/manager.js');

    const setup = mock(async () => undefined);
    const teardown = mock(async () => undefined);
    const createRuntimeEnvironment = mock((options: any) => ({
      setup,
      teardown,
      workspace: {
        workPath: '/repo-shadow',
        baseRepoPath: '/repo',
        strategy: 'worktree',
      },
      initialSnapshotHash: 'shadow-head',
      _options: options,
    }));

    const manager = new SubAgentManager(
      {
        repoRoot: '/repo',
        persistenceRoot: '/repo',
        dryRun: false,
        phase: 'VERIFY',
        llm: {
          chat: mock(),
          createPlan: mock(),
          createPatch: mock(),
        },
      } as any,
      {
        registerAgent: mock(),
        isStopRequested: mock(() => false),
        appendLog: mock(),
        updateStatus: mock(),
        listAgents: mock(() => []),
        getAgent: mock(() => undefined),
        tailLogs: mock(() => []),
        requestStop: mock(() => true),
      } as any,
      {
        registry: {
          get: mock(() => ({
            id: 'surgeon',
            name: 'Surgeon',
            role: 'Coder',
            description: 'test',
            allowedTools: ['fs.read'],
            readOnly: false,
            stratagem: 'surgeon',
            timeoutMs: 1000,
          })),
        },
        createRuntimeEnvironment,
        artifactStore: {
          saveText: mock(),
        },
      } as any,
    );

    await manager.execute({
      agent_ref: 'surgeon',
      task: 'verify helper',
      session_target: 'isolated',
    });

    const runtimeOptions = createRuntimeEnvironment.mock.calls[0]?.[0];
    expect(runtimeOptions).toBeTruthy();
    expect(runtimeOptions.dryRun).toBe(false);
    const initCtx = loopExecuteMock.mock.calls[0]?.[0];
    expect(initCtx?.options?.dryRun).toBe(false);
  });

  it('filters non-plan write tools in read-only phases', async () => {
    const { SubAgentManager } = await import('../../../src/core/sub-agent/core/manager.js');

    const setup = mock(async () => undefined);
    const teardown = mock(async () => undefined);

    const manager = new SubAgentManager(
      {
        repoRoot: '/repo',
        persistenceRoot: '/repo',
        dryRun: false,
        phase: 'PATCH',
        llm: {
          chat: mock(),
          createPlan: mock(),
          createPatch: mock(),
        },
      } as any,
      {
        registerAgent: mock(),
        isStopRequested: mock(() => false),
        appendLog: mock(),
        updateStatus: mock(),
        listAgents: mock(() => []),
        getAgent: mock(() => undefined),
        tailLogs: mock(() => []),
        requestStop: mock(() => true),
      } as any,
      {
        registry: {
          get: mock(() => ({
            id: 'surgeon',
            name: 'Surgeon',
            role: 'Coder',
            description: 'test',
            allowedTools: ['fs.read', 'fs.write', 'plan.update', 'plan.init'],
            readOnly: false,
            stratagem: 'surgeon',
            timeoutMs: 1000,
          })),
        },
        createRuntimeEnvironment: () =>
          ({
            setup,
            teardown,
            workspace: {
              workPath: '/repo-shadow',
              baseRepoPath: '/repo',
              strategy: 'worktree',
            },
            initialSnapshotHash: 'shadow-head',
          }) as any,
        artifactStore: {
          saveText: mock(),
        },
      } as any,
    );

    await manager.execute({
      agent_ref: 'surgeon',
      task: 'guard write tools',
      session_target: 'shared',
    });

    const initCtx = loopExecuteMock.mock.calls[0]?.[0];
    expect(initCtx.options.allowedToolNames).toEqual(['fs.read', 'plan.update', 'plan.init']);
    expect(initCtx.options.allowedToolNames).not.toContain('fs.write');
  });

  it('does not force autopilot dispatch into read-only semantics when using EXPLORE as a bridge phase', async () => {
    const { SubAgentManager } = await import('../../../src/core/sub-agent/core/manager.js');

    const setup = mock(async () => undefined);
    const teardown = mock(async () => undefined);
    const createRuntimeEnvironment = mock((options: any) => ({
      setup,
      teardown,
      workspace: {
        workPath: '/repo-shadow',
        baseRepoPath: '/repo',
        strategy: 'worktree',
      },
      initialSnapshotHash: 'shadow-head',
      _options: options,
    }));

    const manager = new SubAgentManager(
      {
        repoRoot: '/repo',
        persistenceRoot: '/repo',
        dryRun: false,
        flowMode: 'autopilot',
        phase: 'EXPLORE',
        llm: {
          chat: mock(),
          createPlan: mock(),
          createPatch: mock(),
        },
      } as any,
      {
        registerAgent: mock(),
        isStopRequested: mock(() => false),
        appendLog: mock(),
        updateStatus: mock(),
        listAgents: mock(() => []),
        getAgent: mock(() => undefined),
        tailLogs: mock(() => []),
        requestStop: mock(() => true),
      } as any,
      {
        registry: {
          get: mock(() => ({
            id: 'surgeon',
            name: 'Surgeon',
            role: 'Coder',
            description: 'test',
            allowedTools: ['fs.read', 'fs.write', 'plan.update'],
            readOnly: false,
            stratagem: 'surgeon',
            timeoutMs: 1000,
          })),
        },
        createRuntimeEnvironment,
        artifactStore: {
          saveText: mock(),
        },
      } as any,
    );

    await manager.execute({
      agent_ref: 'surgeon',
      task: 'continue editing from autopilot',
      session_target: 'shared',
    });

    const runtimeOptions = createRuntimeEnvironment.mock.calls[0]?.[0];
    expect(runtimeOptions).toBeTruthy();
    expect(runtimeOptions.dryRun).toBe(false);

    const initCtx = loopExecuteMock.mock.calls[0]?.[0];
    expect(initCtx?.options?.dryRun).toBe(false);
    expect(initCtx?.options?.allowedToolNames).toContain('fs.write');
  });
});
