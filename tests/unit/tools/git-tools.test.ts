import { describe, expect, it, beforeEach, mock } from 'bun:test';

import {
  executeGitBlame,
  executeGitLog,
  executeGitShow,
  gitBlameSpec,
  gitLogSpec,
  gitShowSpec,
} from '../../../src/core/tools/builtin/git.js';

const mockExecMeta = mock();

mock.module('../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: class {
    execMeta = mockExecMeta;
  },
}));

describe('git.blame', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('should parse porcelain blame output', async () => {
    const porcelain = [
      'abc123def456789012345678901234567890abcd 1 1 2',
      'author Alice',
      'author-time 1700000000',
      'summary Initial commit',
      'filename src/main.ts',
      '\tconst x = 1;',
      'abc123def456789012345678901234567890abcd 2 2 1',
      'author Alice',
      'author-time 1700000000',
      'summary Initial commit',
      'filename src/main.ts',
      '\tconst y = 2;',
    ].join('\n');

    mockExecMeta.mockResolvedValue({
      ok: true,
      stdout: Buffer.from(porcelain),
      code: 0,
    });

    const result = await executeGitBlame({ file: 'src/main.ts' }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);

    expect(result.file).toBe('src/main.ts');
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      line: 1,
      content: 'const x = 1;',
      commit: 'abc123def456789012345678901234567890abcd',
      author: 'Alice',
    });
  });

  it('should reject path traversal', async () => {
    await expect(
      executeGitBlame({ file: '../passwd' }, { repoRoot, attemptId: 1, dryRun: false } as any),
    ).rejects.toThrow();
  });

  it('should validate schema', () => {
    expect(gitBlameSpec.inputSchema.safeParse({ file: 'test.ts' }).success).toBe(true);
    expect(gitBlameSpec.inputSchema.safeParse({}).success).toBe(false);
  });
});

describe('git.log', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('should parse NUL-separated log output', async () => {
    const NUL = '\x00';
    const output = `hash1${NUL}subject1${NUL}author1${NUL}2024-01-01T00:00:00Z${NUL}parent1${NUL}hash2${NUL}subject2${NUL}author2${NUL}2024-01-02T00:00:00Z${NUL}`;

    mockExecMeta.mockResolvedValue({
      ok: true,
      stdout: Buffer.from(output, 'utf8'),
      code: 0,
    });

    const result = await executeGitLog({ maxCount: 20, diffStat: false }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);

    expect(result.commits).toHaveLength(2);
    expect(result.commits[0]).toMatchObject({
      hash: 'hash1',
      subject: 'subject1',
      author: 'author1',
      date: '2024-01-01T00:00:00Z',
      parentHashes: 'parent1',
    });
  });

  it('should validate schema', () => {
    expect(gitLogSpec.inputSchema.safeParse({}).success).toBe(true);
    expect(gitLogSpec.inputSchema.safeParse({ maxCount: 50, file: 'test.ts' }).success).toBe(true);
  });
});

describe('git.show', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('should return raw content', async () => {
    const diff = 'commit abc123\nAuthor: Alice\n\n    Fix bug\n\ndiff --git a/foo b/foo\n+bar';

    mockExecMeta.mockResolvedValue({
      ok: true,
      stdout: Buffer.from(diff),
      code: 0,
    });

    const result = await executeGitShow({ ref: 'abc123', stat: true }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);

    expect(result.ref).toBe('abc123');
    expect(result.content).toBe(diff);
  });

  it('should validate schema', () => {
    expect(gitShowSpec.inputSchema.safeParse({ ref: 'HEAD' }).success).toBe(true);
    expect(gitShowSpec.inputSchema.safeParse({}).success).toBe(false);
  });
});
