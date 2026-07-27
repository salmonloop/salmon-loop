import { describe, expect, it, beforeEach, mock } from 'bun:test';

import { spawnCommand } from '../../../src/core/runtime/process-runner.js';
import { executeGlobFind, globFindSpec } from '../../../src/core/tools/builtin/glob.js';

mock.module('../../../src/core/runtime/process-runner.js', () => ({
  spawnCommand: mock(),
}));

describe('glob.find', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {});

  it('should return matched files', async () => {
    (spawnCommand as any).mockImplementation(async (opts: any) => {
      opts.onStdoutChunk?.(Buffer.from('src/a.ts\nsrc/b.ts\n'));
      return { code: 0 };
    });

    const result = await executeGlobFind({ pattern: '**/*.ts' }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);

    expect(result.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.totalFound).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('should truncate at maxMatches', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `src/file${i}.ts`).join('\n');
    (spawnCommand as any).mockImplementation(async (opts: any) => {
      opts.onStdoutChunk?.(Buffer.from(lines));
      return { code: 0 };
    });

    const result = await executeGlobFind({ pattern: '**/*.ts', maxMatches: 10 }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);

    expect(result.files).toHaveLength(10);
    expect(result.totalFound).toBe(300);
    expect(result.truncated).toBe(true);
  });

  it('should return empty on rg failure', async () => {
    (spawnCommand as any).mockResolvedValue({ code: 2, error: new Error('rg not found') });

    const result = await executeGlobFind({ pattern: '**/*.ts' }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);

    expect(result.files).toEqual([]);
    expect(result.totalFound).toBe(0);
  });

  it('should pass --no-ignore when respectGitignore is false', async () => {
    (spawnCommand as any).mockImplementation(async (opts: any) => {
      expect(opts.args).toContain('--no-ignore');
      opts.onStdoutChunk?.(Buffer.from(''));
      return { code: 0 };
    });

    await executeGlobFind({ pattern: '**/*.ts', respectGitignore: false }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);
  });

  it('should pass --hidden when includeHidden is true', async () => {
    (spawnCommand as any).mockImplementation(async (opts: any) => {
      expect(opts.args).toContain('--hidden');
      opts.onStdoutChunk?.(Buffer.from(''));
      return { code: 0 };
    });

    await executeGlobFind({ pattern: '**/*.ts', includeHidden: true }, {
      repoRoot,
      attemptId: 1,
      dryRun: false,
    } as any);
  });

  it('should validate schema', () => {
    expect(globFindSpec.inputSchema.safeParse({ pattern: '*.ts' }).success).toBe(true);
    expect(globFindSpec.inputSchema.safeParse({}).success).toBe(false);
  });
});
