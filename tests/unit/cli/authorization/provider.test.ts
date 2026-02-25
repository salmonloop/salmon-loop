import { describe, expect, it, beforeEach, afterEach } from 'bun:test';

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

  beforeEach(() => {
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
});
