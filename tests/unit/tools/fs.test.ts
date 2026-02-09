import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { executeFsReadFile, fsReadFileSpec } from '../../../src/core/tools/builtin/fs.js';

describe('Builtin Tool: fs.read_file', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'salmon-fs-test-'));
    await fs.writeFile(path.join(repoRoot, 'test.txt'), 'hello salmon');
    await fs.mkdir(path.join(repoRoot, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'subdir', 'config.json'), '{"key": "value"}');
  });

  afterEach(async () => {
    if (repoRoot) {
      await fs.rm(repoRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('should read a file within the repository', async () => {
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
