import { readdir } from 'fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAllBuiltins } from '../../../src/core/tools/builtin/index.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';

vi.mock('fs/promises');

describe('Builtin Tool: fs.list', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getFsListSpec() {
    const registry = new ToolRegistry();
    registerAllBuiltins(registry);
    return registry.getSpec('fs.list');
  }

  it('is registered', () => {
    const spec = getFsListSpec();
    expect(spec).toBeDefined();
  });

  it('lists directory entries within the repository', async () => {
    const spec = getFsListSpec();
    expect(spec).toBeDefined();
    if (!spec) throw new Error('fs.list spec missing');

    vi.mocked(readdir).mockResolvedValue([
      {
        name: 'src',
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      },
      {
        name: 'README.md',
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      },
    ] as any);

    const out = await spec.executor({ path: '.' }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);

    expect(out).toMatchObject({
      truncated: false,
      totalEntries: 2,
      entries: [
        { name: 'README.md', path: 'README.md', type: 'file' },
        { name: 'src', path: 'src', type: 'dir' },
      ],
    });
  });

  it('blocks path traversal attempts (CRITICAL SAFETY)', async () => {
    const spec = getFsListSpec();
    expect(spec).toBeDefined();
    if (!spec) throw new Error('fs.list spec missing');

    await expect(
      spec.executor({ path: '../secrets' }, {
        repoRoot,
        attemptId: 1,
        dryRun: false,
      } as any),
    ).rejects.toThrow(/Access denied/);
  });
});
