import { PassThrough } from 'stream';

import { afterEach, describe, expect, it, mock } from 'bun:test';

import { clearLogger, setLogger } from '../../../../../src/core/observability/logger.js';

const spawnInteractiveProcessMock = mock().mockImplementation(() => ({
  stdout: new PassThrough(),
  stderr: new PassThrough(),
  stdin: { write: mock() },
  on: mock().mockReturnThis(),
  kill: mock(),
}));

describe('McpClient (stdio)', () => {
  afterEach(() => {
    clearLogger();
    mock.restore();
  });

  it('pipes stderr instead of inheriting it', async () => {
    setLogger({ info: mock(), warn: mock(), error: mock(), success: mock() } as any);
    const runtime = await import('../../../../../src/core/runtime/process-runner.js');
    spyOn(runtime, 'spawnInteractiveProcess').mockImplementation(
      spawnInteractiveProcessMock as any,
    );
    const { McpClient } = await import('../../../../../src/core/tools/mcp/client.js');
    spyOn(McpClient.prototype as any, 'initialize').mockResolvedValue(undefined);
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
