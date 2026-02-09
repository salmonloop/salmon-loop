import { readFile, stat } from 'fs/promises';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { executeFsReadFile, fsReadFileSpec } from '../../../src/core/tools/builtin/fs.js';

vi.mock('fs/promises');

describe('Builtin Tool: fs.read_file', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read a file within the repository', async () => {
    // Setup mocks
    vi.mocked(stat).mockResolvedValue({ size: 12 } as any);
    vi.mocked(readFile).mockResolvedValue('hello salmon');

    const result = await executeFsReadFile(
      { file: 'test.txt' },
      {
        repoRoot,
        attemptId: 1,
        dryRun: false,
      },
    );

    expect(result.content).toBe('hello salmon');
    expect(result.size).toBe(12);
    // Verify it called the right path
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining('test.txt'), 'utf-8');
  });

  it('should block path traversal attempts (CRITICAL SAFETY)', async () => {
    const ctx = { repoRoot, attemptId: 1, dryRun: false };

    await expect(executeFsReadFile({ file: '../passwd' }, ctx)).rejects.toThrow(/Access denied/);
    await expect(executeFsReadFile({ file: '/etc/passwd' }, ctx)).rejects.toThrow(/Access denied/);
  });

  it('should validate input schema', () => {
    const invalidInput = { file: 123 };
    const result = fsReadFileSpec.inputSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });

  it('should accept `path` alias and normalize to `file`', () => {
    const result = fsReadFileSpec.inputSchema.safeParse({ path: 'test.txt' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.file).toBe('test.txt');
  });
});
