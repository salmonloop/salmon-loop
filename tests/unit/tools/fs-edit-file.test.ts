import { describe, expect, it, beforeEach, mock } from 'bun:test';

import { readFile } from '../../../src/core/adapters/fs/node-fs.js';
import { executeFsEditFile, fsEditFileSpec } from '../../../src/core/tools/builtin/fs.js';

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  readFile: mock(),
  stat: mock(),
}));

mock.module('../../../src/core/adapters/fs/atomic-file-writer.js', () => ({
  AtomicFileWriter: class {
    writeAtomic = mock();
    deleteAtomic = mock();
  },
}));

describe('Builtin Tool: fs.edit_file', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {});

  it('should replace a single occurrence', async () => {
    (readFile as any).mockResolvedValue('hello world\n');

    const result = await executeFsEditFile(
      { file: 'test.txt', old_string: 'world', new_string: 'salmon' },
      { repoRoot, attemptId: 1, dryRun: false },
    );

    expect(result.ok).toBe(true);
    expect(result.replacements).toBe(1);
  });

  it('should replace all occurrences with replace_all', async () => {
    (readFile as any).mockResolvedValue('aaa bbb aaa ccc aaa');

    const result = await executeFsEditFile(
      { file: 'test.txt', old_string: 'aaa', new_string: 'xxx', replace_all: true },
      { repoRoot, attemptId: 1, dryRun: false },
    );

    expect(result.ok).toBe(true);
    expect(result.replacements).toBe(3);
  });

  it('should throw when old_string not found', async () => {
    (readFile as any).mockResolvedValue('hello world\n');

    await expect(
      executeFsEditFile(
        { file: 'test.txt', old_string: 'nonexistent', new_string: 'x' },
        { repoRoot, attemptId: 1, dryRun: false },
      ),
    ).rejects.toThrow(/old_string not found/);
  });

  it('should throw when multiple matches without replace_all', async () => {
    (readFile as any).mockResolvedValue('aaa bbb aaa');

    await expect(
      executeFsEditFile(
        { file: 'test.txt', old_string: 'aaa', new_string: 'xxx' },
        { repoRoot, attemptId: 1, dryRun: false },
      ),
    ).rejects.toThrow(/found 2 times/);
  });

  it('should reject empty old_string via schema', () => {
    const result = fsEditFileSpec.inputSchema.safeParse({
      file: 'test.txt',
      old_string: '',
      new_string: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('should return ok with zero replacements in dryRun mode', async () => {
    const result = await executeFsEditFile(
      { file: 'test.txt', old_string: 'x', new_string: 'y' },
      { repoRoot, attemptId: 1, dryRun: true },
    );

    expect(result.ok).toBe(true);
    expect(result.replacements).toBe(0);
  });

  it('should accept path alias and normalize to file', () => {
    const result = fsEditFileSpec.inputSchema.safeParse({
      path: 'test.txt',
      old_string: 'a',
      new_string: 'b',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.file).toBe('test.txt');
  });
});
