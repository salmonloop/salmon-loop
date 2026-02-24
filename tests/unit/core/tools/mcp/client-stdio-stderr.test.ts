import { PassThrough } from 'stream';

import { describe, expect, it, vi } from 'bun:test';

const spawnInteractiveProcessMock = vi.fn().mockImplementation(() => ({
  stdout: new PassThrough(),
  stderr: new PassThrough(),
  stdin: { write: vi.fn() },
  on: vi.fn().mockReturnThis(),
  kill: vi.fn(),
}));

describe('McpClient (stdio)', () => {
  it('pipes stderr instead of inheriting it', async () => {
    const runtime = await import('../../../../../src/core/runtime/process-runner.js');
    vi.spyOn(runtime, 'spawnInteractiveProcess').mockImplementation(
      spawnInteractiveProcessMock as any,
    );
    const { McpClient } = await import('../../../../../src/core/tools/mcp/client.js');
    vi.spyOn(McpClient.prototype as any, 'initialize').mockResolvedValue(undefined);
    const client = new McpClient({
      name: 'test',
      command: 'node',
      args: ['server.js'],
    });

    await client.start();

    const lastCall = spawnInteractiveProcessMock.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    const options = lastCall?.[0] as any;
    expect(options?.windowsHide).toBe(true);
  });
});
