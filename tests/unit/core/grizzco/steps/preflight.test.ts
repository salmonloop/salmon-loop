import { beforeEach, describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  preflight: mock(),
  createStandardToolstack: mock(),
  resolveLlmToolCallingPolicy: mock(),
  recordAuditEvent: mock(),
}))();

mock.module('../../../../../src/core/verification/runner.js', () => ({
  preflight: hoisted.preflight,
}));

mock.module('../../../../../src/core/tools/loader.js', () => ({
  createStandardToolstack: hoisted.createStandardToolstack,
}));

mock.module('../../../../../src/core/grizzco/dsl/llm-strategy.js', () => ({
  resolveLlmToolCallingPolicy: hoisted.resolveLlmToolCallingPolicy,
}));

mock.module('../../../../../src/core/observability/audit-trail.js', () => ({
  recordAuditEvent: hoisted.recordAuditEvent,
}));

describe('grizzco runPreflight', () => {
  beforeEach(() => {
    mock.restore();
    hoisted.preflight.mockResolvedValue({ ok: true });
    hoisted.resolveLlmToolCallingPolicy.mockReturnValue({ enabled: true, maxRounds: 4 });
    hoisted.createStandardToolstack.mockResolvedValue({
      audit: {
        getLogs: () => [],
      },
    });
  });

  it('uses the execution profile entry phase when resolving tool policy', async () => {
    const { runPreflight } = await import('../../../../../src/core/grizzco/steps/preflight.js');

    await runPreflight({
      mode: 'autopilot',
      options: {
        instruction: 'act',
        llm: { getModelId: () => 'gpt-test' },
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'direct',
      },
      emit: () => {},
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
    } as any);

    expect(hoisted.resolveLlmToolCallingPolicy).toHaveBeenCalledWith(
      'AUTOPILOT',
      expect.any(Object),
    );
  });

  it('keeps recipe flows on PLAN for toolstack initialization', async () => {
    const { runPreflight } = await import('../../../../../src/core/grizzco/steps/preflight.js');

    await runPreflight({
      mode: 'patch',
      options: {
        instruction: 'act',
        llm: { getModelId: () => 'gpt-test' },
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'worktree',
      },
      emit: () => {},
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
    } as any);

    expect(hoisted.resolveLlmToolCallingPolicy).toHaveBeenCalledWith('PLAN', expect.any(Object));
  });

  it('ignores dirty preflight for autopilot even when permissionMode is interactive', async () => {
    const { runPreflight } = await import('../../../../../src/core/grizzco/steps/preflight.js');

    await runPreflight({
      mode: 'autopilot',
      options: {
        instruction: 'act',
        llm: { getModelId: () => 'gpt-test' },
        permissionMode: 'interactive',
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'direct',
      },
      emit: () => {},
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
    } as any);

    expect(hoisted.preflight).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ ignoreDirty: true, requireGit: false }),
    );
  });

  it('keeps patch preflight strict even when permissionMode is yolo', async () => {
    const { runPreflight } = await import('../../../../../src/core/grizzco/steps/preflight.js');

    await runPreflight({
      mode: 'patch',
      options: {
        instruction: 'act',
        llm: { getModelId: () => 'gpt-test' },
        permissionMode: 'yolo',
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'worktree',
      },
      emit: () => {},
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
    } as any);

    expect(hoisted.preflight).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ ignoreDirty: false, requireGit: true }),
    );
  });

  it('keeps git required when autopilot uses an isolated worktree', async () => {
    const { runPreflight } = await import('../../../../../src/core/grizzco/steps/preflight.js');

    await runPreflight({
      mode: 'autopilot',
      options: {
        instruction: 'act',
        llm: { getModelId: () => 'gpt-test' },
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo/.salmonloop/worktrees/1',
        strategy: 'worktree',
      },
      emit: () => {},
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
    } as any);

    expect(hoisted.preflight).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ requireGit: true }),
    );
  });
});
