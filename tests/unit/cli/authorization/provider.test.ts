import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';

mock.module('readline/promises', () => ({
  createInterface: () => {
    throw new Error('createInterface should not be called in forced non-interactive mode');
  },
}));

mock.module('../../../../src/cli/authorization/allowlist.js', () => ({
  loadAllowlistDecision: mock(async () => null),
  persistAllowlistDecision: mock(async () => {}),
}));

mock.module('../../../../src/cli/authorization/non-interactive.js', () => ({
  requestNonInteractiveAuthorizationDecision: mock(async () => ({
    outcome: 'allow_once',
    source: 'hook',
  })),
}));

describe('createTerminalAuthorizationProvider', () => {
  const originalStdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

  let loadAllowlistDecisionMock: any;
  let requestNonInteractiveAuthorizationDecisionMock: any;

  beforeEach(async () => {
    const allowlist = await import('../../../../src/cli/authorization/allowlist.js');
    const nonInteractive = await import('../../../../src/cli/authorization/non-interactive.js');
    loadAllowlistDecisionMock = allowlist.loadAllowlistDecision;
    requestNonInteractiveAuthorizationDecisionMock =
      nonInteractive.requestNonInteractiveAuthorizationDecision;

    loadAllowlistDecisionMock.mockClear();
    requestNonInteractiveAuthorizationDecisionMock.mockClear();

    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    if (originalStdinIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalStdinIsTTY);
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY);
  });

  it('uses non-interactive authorization when forced, even on TTY', async () => {
    const { createTerminalAuthorizationProvider } =
      await import('../../../../src/cli/authorization/provider.js');
    const { requestNonInteractiveAuthorizationDecision } =
      await import('../../../../src/cli/authorization/non-interactive.js');

    const provider = createTerminalAuthorizationProvider({ forceNonInteractive: true });
    const decision = await provider.requestAuthorization({
      id: 'req-1',
      toolName: 'Bash',
      source: 'builtin',
      phase: 'PREFLIGHT',
      riskLevel: 'medium',
      sideEffects: [],
      repoRoot: process.cwd(),
      attemptId: 1,
      timestamp: Date.now(),
    });

    expect(requestNonInteractiveAuthorizationDecision).toHaveBeenCalledTimes(1);
    expect(decision.outcome).toBe('allow_once');
  });

  it('returns pending in deferred mode for forced non-interactive command strategy', async () => {
    const { createTerminalAuthorizationProvider } =
      await import('../../../../src/cli/authorization/provider.js');
    const { requestNonInteractiveAuthorizationDecision } =
      await import('../../../../src/cli/authorization/non-interactive.js');

    const provider = createTerminalAuthorizationProvider({
      forceNonInteractive: true,
      config: {
        nonInteractive: {
          strategy: 'command',
          command: { cmd: 'echo {"outcome":"allow_once"}' },
        },
      },
    });

    const request = {
      id: 'req-2',
      toolName: 'context.cache.outside_root',
      source: 'builtin' as const,
      phase: 'CONTEXT' as const,
      riskLevel: 'high' as const,
      sideEffects: ['fs_write' as const],
      repoRoot: process.cwd(),
      attemptId: 1,
      timestamp: Date.now(),
    };
    const deferred = await provider.requestAuthorizationDeferred?.(request);
    expect(deferred).toEqual({
      kind: 'pending',
      challenge: 'req-2',
      message: expect.any(String),
    });
    expect(requestNonInteractiveAuthorizationDecision).toHaveBeenCalledTimes(0);

    const resolved = await provider.waitForAuthorization?.('req-2');
    expect(requestNonInteractiveAuthorizationDecision).toHaveBeenCalledTimes(1);
    expect(resolved?.outcome).toBe('allow_once');
  });

  it('auto-approves without allowlist or prompt when permission mode is yolo', async () => {
    const { createTerminalAuthorizationProvider } =
      await import('../../../../src/cli/authorization/provider.js');
    const { loadAllowlistDecision } =
      await import('../../../../src/cli/authorization/allowlist.js');
    const { requestNonInteractiveAuthorizationDecision } =
      await import('../../../../src/cli/authorization/non-interactive.js');

    const provider = createTerminalAuthorizationProvider({
      permissionMode: 'yolo' as any,
      forceNonInteractive: true,
    });
    const decision = await provider.requestAuthorization({
      id: 'req-yolo',
      toolName: 'Bash',
      source: 'builtin',
      phase: 'PATCH',
      riskLevel: 'high',
      sideEffects: ['fs_write'],
      repoRoot: process.cwd(),
      attemptId: 1,
      timestamp: Date.now(),
    });

    expect(decision.outcome).toBe('allow_session');
    expect(decision.source).toBe('auto');
    expect(decision.reason).toBe('permission_mode_yolo');
    expect(loadAllowlistDecision).toHaveBeenCalledTimes(0);
    expect(requestNonInteractiveAuthorizationDecision).toHaveBeenCalledTimes(0);
  });
});
