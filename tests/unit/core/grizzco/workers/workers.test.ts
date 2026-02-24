import * as fs from 'fs/promises';

import { describe, expect, it, vi } from 'bun:test';

import { GitAdapter } from '../../../../../src/core/adapters/git/git-adapter.js';
import { FileState, FileStatus } from '../../../../../src/core/grizzco/domain/grizzco-types.js';
import { ThreeWayStagedAwareWorker } from '../../../../../src/core/grizzco/workers/three-way-staged-worker.js';
import { UnionMergeWorker } from '../../../../../src/core/grizzco/workers/union-merge-worker.js';

// Unit tests should mock external dependencies like FS.
// With per-file Bun worker isolation, this mock will not leak.
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('Grizzco Workers', () => {
  describe('UnionMergeWorker', () => {
    const worker = new UnionMergeWorker();

    it('should append content for safe extensions (.txt)', async () => {
      const state = {
        path: 'doc.txt',
        absolutePath: '/root/doc.txt',
        status: FileStatus.STAGED_MODIFIED,
        isBinary: false,
        isSymlink: false,
        isIgnored: false,
        size: 100,
      } as FileState;

      const op = {
        type: 'modify',
        path: 'doc.txt',
        content: Buffer.from('New Line'),
      } as any;

      // Setup mock return value
      (fs.readFile as any).mockResolvedValue(Buffer.from('Existing Line') as any);

      const result = await worker.execute(op, state, { repoRoot: '/root' });

      expect(result.success).toBe(true);
      expect(result.mergedContent?.toString()).toContain('Existing Line');
      expect(result.mergedContent?.toString()).toContain('New Line');
      expect(result.mergedContent?.toString()).toContain('<!-- === AI Generated Content === -->');
    });

    it('should reject unsafe extensions (.ts)', async () => {
      const state = {
        path: 'code.ts',
        absolutePath: '/root/code.ts',
        status: FileStatus.STAGED_MODIFIED,
        isBinary: false,
        isSymlink: false,
        isIgnored: false,
        size: 100,
      } as FileState;

      const result = await worker.execute({} as any, state);

      expect(result.success).toBe(false);
      expect(result.isConflict).toBe(true); // Should create .rej
      expect(result.error).toContain('Code files do not support forced append');
    });
  });

  describe('ThreeWayStagedAwareWorker', () => {
    it('should fetch Index content for Ours', async () => {
      const mockGit = {
        show: vi.fn().mockResolvedValue(Buffer.from('content')),
        mergeFile: vi.fn().mockResolvedValue({
          content: Buffer.from('merged'),
          hasConflict: false,
        }),
      } as unknown as GitAdapter;

      const worker = new ThreeWayStagedAwareWorker(mockGit);

      const state = {
        path: 'file.ts',
        absolutePath: '/root/file.ts',
        status: FileStatus.STAGED_MODIFIED,
        isBinary: false,
        repoPath: '/root',
        isSymlink: false,
        isIgnored: false,
        size: 100,
      } as FileState;

      const op = {
        type: 'modify',
        path: 'file.ts',
        content: Buffer.from('new'),
      } as any;

      await worker.execute(op, state);

      // Verify it fetched from Index (:0)
      expect(mockGit.show).toHaveBeenCalledWith(':0', 'file.ts');
      // Verify it fetched Base (HEAD)
      expect(mockGit.show).toHaveBeenCalledWith('HEAD', 'file.ts');
    });

    it('should reject binary files', async () => {
      const worker = new ThreeWayStagedAwareWorker({} as GitAdapter);
      const state = {
        path: 'img.png',
        isBinary: true,
        isSymlink: false,
        isIgnored: false,
        size: 100,
      } as FileState;

      const result = await worker.execute({} as any, state);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Binary files do not support staged auto-merge');
    });
  });
});
