import { describe, expect, it } from 'bun:test';

describe('ACP filesystem (fs/*)', () => {
  it('delegates readFile/writeFile to ACP client methods', async () => {
    const calls: Array<{ method: string; path: string; content?: string }> = [];
    const conn = {
      readTextFile: async ({ path }: { path: string }) => {
        calls.push({ method: 'read', path });
        return { content: 'hello' };
      },
      writeTextFile: async ({ path, content }: { path: string; content: string }) => {
        calls.push({ method: 'write', path, content });
        return {};
      },
    };

    const { createAcpFileSystem } =
      await import('../../../src/core/protocols/acp/acp-filesystem.js');

    const fs = createAcpFileSystem({ conn: conn as any, sessionId: 's1' });
    expect(await fs.readFile('/repo/a.txt')).toBe('hello');
    await fs.writeFile('/repo/b.txt', 'world');

    expect(calls).toEqual([
      { method: 'read', path: '/repo/a.txt' },
      { method: 'write', path: '/repo/b.txt', content: 'world' },
    ]);
  });

  it('returns exists=false when ACP returns resource not found (-32002)', async () => {
    const conn = {
      readTextFile: async () => {
        const err = Object.assign(new Error('not found'), { code: -32002 });
        throw err;
      },
      writeTextFile: async () => ({}),
    };

    const { createAcpFileSystem } =
      await import('../../../src/core/protocols/acp/acp-filesystem.js');
    const fs = createAcpFileSystem({ conn: conn as any, sessionId: 's1' });

    expect(await fs.exists('/repo/missing.txt')).toBe(false);
  });
});
