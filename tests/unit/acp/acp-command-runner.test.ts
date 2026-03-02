import { describe, expect, it } from 'bun:test';

describe('ACP command runner (terminal/*)', () => {
  it('streams output deltas and always releases terminal', async () => {
    const outputCalls: string[] = [];
    const released: { value: boolean } = { value: false };

    let poll = 0;
    const terminalHandle = {
      id: 't1',
      currentOutput: async () => {
        poll++;
        if (poll === 1) return { output: 'a', truncated: false, exitStatus: null };
        if (poll === 2) return { output: 'ab', truncated: false, exitStatus: null };
        return { output: 'abc', truncated: false, exitStatus: { exitCode: 0, signal: null } };
      },
      waitForExit: async () => ({ exitCode: 0, signal: null }),
      kill: async () => ({}),
      release: async () => {
        released.value = true;
        return {};
      },
    };

    const conn = {
      createTerminal: async () => terminalHandle,
    };

    const { createAcpCommandRunner } =
      await import('../../../src/core/protocols/acp/acp-command-runner.js');

    const runner = createAcpCommandRunner({
      conn: conn as any,
      sessionId: 's1',
    });

    const result = await runner.spawnCommand({
      command: 'echo',
      args: ['hi'],
      onStdoutChunk: (chunk) => outputCalls.push(Buffer.from(chunk).toString('utf8')),
    });

    expect(outputCalls.join('')).toBe('abc');
    expect(released.value).toBe(true);
    expect(result.code).toBe(0);
  });
});
