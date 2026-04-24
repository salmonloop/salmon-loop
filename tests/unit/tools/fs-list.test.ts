import { beforeEach, describe, expect, it } from 'bun:test';

import { readdir } from '../../../src/core/adapters/fs/node-fs.js';
import { registerAllBuiltins } from '../../../src/core/tools/builtin/index.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  readdir: mock(),
}));

describe('Builtin Tool: fs.list', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {
    mock.clearAllMocks();
  });

  function getFsListSpec() {
    const registry = new ToolRegistry();
    registerAllBuiltins(registry);
    return registry.getSpec('fs.list');
  }

  function getSpec(name: 'fs.list' | 'fs.list_directory' | 'fs.list_files') {
    const registry = new ToolRegistry();
    registerAllBuiltins(registry);
    return registry.getSpec(name);
  }

  it('is registered', () => {
    const spec = getFsListSpec();
    expect(spec).toBeDefined();
  });

  it('lists directory entries within the repository', async () => {
    const spec = getFsListSpec();
    expect(spec).toBeDefined();
    if (!spec) throw new Error('fs.list spec missing');

    (readdir as any).mockResolvedValue([
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

  it('accepts string input as a path shorthand', () => {
    const spec = getFsListSpec();
    expect(spec).toBeDefined();
    if (!spec) throw new Error('fs.list spec missing');

    const parsed = spec.inputSchema.safeParse('.');
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({ path: '.' });
  });

  it('coerces includeHidden when provided as a string', () => {
    const spec = getFsListSpec();
    expect(spec).toBeDefined();
    if (!spec) throw new Error('fs.list spec missing');

    const parsedFalse = spec.inputSchema.safeParse({
      path: '.',
      includeHidden: 'false',
      maxEntries: '50',
    });
    expect(parsedFalse.success).toBe(true);
    expect(parsedFalse.success && parsedFalse.data).toMatchObject({
      path: '.',
      includeHidden: false,
      maxEntries: 50,
    });

    const parsedTrue = spec.inputSchema.safeParse({ path: '.', includeHidden: 'true' });
    expect(parsedTrue.success).toBe(true);
    expect(parsedTrue.success && parsedTrue.data).toMatchObject({ includeHidden: true });
  });

  it('blocks reserved directories for all fs list variants', async () => {
    for (const toolName of ['fs.list', 'fs.list_directory', 'fs.list_files'] as const) {
      const spec = getSpec(toolName);
      expect(spec).toBeDefined();
      if (!spec) throw new Error(`${toolName} spec missing`);

      await expect(
        spec.executor({ path: '.git' }, {
          repoRoot,
          attemptId: 1,
          dryRun: false,
        } as any),
      ).rejects.toThrow(/reserved path prefix/i);

      await expect(
        spec.executor({ path: '.salmonloop/plans' }, {
          repoRoot,
          attemptId: 1,
          dryRun: false,
        } as any),
      ).rejects.toThrow(/reserved path prefix/i);
    }

    expect(readdir).not.toHaveBeenCalled();
  });

  it('does not expose reserved directories when listing the repo root with hidden entries enabled', async () => {
    const spec = getFsListSpec();
    expect(spec).toBeDefined();
    if (!spec) throw new Error('fs.list spec missing');

    (readdir as any).mockResolvedValue([
      {
        name: '.git',
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      },
      {
        name: '.salmonloop',
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      },
      {
        name: '.env',
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      },
      {
        name: 'src',
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      },
    ] as any);

    const out = await spec.executor({ path: '.', includeHidden: true }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);

    expect(out).toMatchObject({
      truncated: false,
      totalEntries: 2,
      entries: [
        { name: '.env', path: '.env', type: 'file' },
        { name: 'src', path: 'src', type: 'dir' },
      ],
    });
  });
});
