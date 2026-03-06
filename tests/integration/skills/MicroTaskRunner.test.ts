import { describe, it, expect } from 'bun:test';

import { MicroTaskRunner } from '../../../src/core/skills/runtime/MicroTaskRunner.js';
import { ToolRuntimeCtx } from '../../../src/core/tools/types.js';

describe('MicroTaskRunner (Integration)', () => {
  const mockCtx: ToolRuntimeCtx = {
    repoRoot: process.cwd(),
    attemptId: 1,
    dryRun: false,
  };

  it('should handle the Ping-Pong loop for dynamic commands', async () => {
    const skill = {
      id: 'ping-pong-test',
      path: 'test.md',
      metadata: { name: 'test', description: 'test' },
      instructions: '!sh echo "ping"\nResult: $args',
      rawContent: '',
    };
    const runner = new MicroTaskRunner(skill);

    const result = await runner.execute({ args: 'success' }, mockCtx);

    expect(result.status).toBe('SUCCESS');
    // On Windows (cmd.exe), echo "ping" outputs "ping" with quotes; on POSIX, it outputs ping without quotes.
    // We accept either outcome as both are correct shell behavior.
    const expectedCmdOutput = result.dynamicCommands[0].output;
    // On Windows (cmd.exe), echo "ping" may output with various quote escaping levels.
    // Accept any form: ping, "ping", \"ping\", or \\\"ping\\\"
    expect(expectedCmdOutput).toContain('ping');
    expect(result.injectedPrompt).toBe('Result: success');
  });

  it('should physically intercept commands in dryRun mode', async () => {
    const dryCtx = { ...mockCtx, dryRun: true };
    const skill = {
      id: 'dry-run-test',
      path: 'test.md',
      metadata: { name: 'test', description: 'test' },
      instructions: '!sh touch dangerous.txt\nAssemble prompt.',
      rawContent: '',
    };
    const runner = new MicroTaskRunner(skill);

    const result = await runner.execute({ args: '' }, dryCtx);

    expect(result.dynamicCommands[0].output).toContain('[DRY_RUN]');
    expect(result.status).toBe('SUCCESS');
  });
});
