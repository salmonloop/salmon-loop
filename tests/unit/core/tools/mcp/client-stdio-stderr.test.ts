import { spawn } from 'child_process';

import { describe, expect, it, vi } from 'vitest';

import { McpClient } from '../../../../../src/core/tools/mcp/client.js';

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('events');
  const { PassThrough } = await import('stream');
  return {
    spawn: vi.fn().mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdin.write = vi.fn();
      child.kill = vi.fn();
      return child;
    }),
  };
});

describe('McpClient (stdio)', () => {
  it('pipes stderr instead of inheriting it', async () => {
    const client = new McpClient({
      name: 'test',
      command: 'node',
      args: ['server.js'],
    });

    // Avoid going through initialize handshake; we only care about spawn options here.
    vi.spyOn(client as any, 'initialize').mockResolvedValue(undefined);

    await client.start();

    const lastCall = vi.mocked(spawn).mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    const options = lastCall?.[2] as any;
    expect(options?.stdio?.[2]).toBe('pipe');
  });
});
