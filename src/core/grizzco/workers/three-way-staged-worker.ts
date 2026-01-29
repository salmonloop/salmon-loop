import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'os';
import * as path from 'path';

import { TextNormalizer } from '../../../utils/eol.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { FileState, MergeResult, ShadowOperation } from '../../shared/types/grizzco-types.js';

import { IMergeWorker } from './i-merge-worker.js';

/**
 * Staged Aware Three-Way Merge Worker
 * Use case: File has changes in Index (Staged).
 *
 * Base: HEAD
 * Ours: Index (Staged content)
 * Theirs: AI Content
 *
 * Result matches Zero Index Access: We read from Index, but the result will be written to Worktree (Unstaged).
 */
export class ThreeWayStagedAwareWorker implements IMergeWorker {
  readonly id = '3way-staged-aware';

  constructor(
    private git: GitAdapter,
    private normalizer?: TextNormalizer,
  ) {}

  async execute(op: ShadowOperation, state: FileState): Promise<MergeResult> {
    const startTime = Date.now();

    // Binary check (Safety)
    if (state.isBinary) {
      return {
        path: state.path,
        success: false,
        error: 'Binary files do not support staged auto-merge',
        isConflict: true,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }

    try {
      // 1. Get Base (HEAD)
      const base = await this.git.show('HEAD', state.path);

      // 2. Get Ours (Index / Staged)
      const ours = await this.git.show(':0', state.path);

      // 3. Get Theirs (AI Content)
      const theirs = op.content!;

      // 4. Perform Merge
      const merged = await this.gitMergeFile(base, theirs, ours);

      return {
        path: state.path,
        success: !merged.hasConflict,
        mergedContent: merged.content,
        isConflict: merged.hasConflict,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        path: state.path,
        success: false,
        error: `Staged merge failed: ${error.message}`,
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }
  }

  private async gitMergeFile(
    base: Buffer,
    theirs: Buffer,
    ours: Buffer,
  ): Promise<{ content: Buffer; hasConflict: boolean }> {
    const tempDir = tmpdir();
    const id = randomBytes(4).toString('hex');
    const tempBase = path.join(tempDir, `s8p-base-${id}`);
    const tempTheirs = path.join(tempDir, `s8p-theirs-${id}`);
    const tempOurs = path.join(tempDir, `s8p-ours-${id}`);

    try {
      await fs.writeFile(tempBase, base);
      await fs.writeFile(tempTheirs, theirs);
      await fs.writeFile(tempOurs, ours);

      return await this.git.mergeFile(tempBase, tempOurs, tempTheirs);
    } finally {
      await Promise.all([
        fs.unlink(tempBase).catch(() => {}),
        fs.unlink(tempTheirs).catch(() => {}),
        fs.unlink(tempOurs).catch(() => {}),
      ]);
    }
  }
}
