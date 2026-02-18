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
});
