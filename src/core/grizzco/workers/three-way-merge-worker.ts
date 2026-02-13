import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'os';
import * as path from 'path';

import { TextNormalizer } from '../../../utils/eol.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { FileState, MergeResult, ShadowOperation } from '../domain/grizzco-types.js';

import { IMergeWorker } from './i-merge-worker.js';

/**
 * Standard Three-Way Merge Worker
 * Use case: Unstaged modifications in text files.
 *
 * Base: HEAD
 * Ours: Working Tree (File on disk)
 * Theirs: AI Content
 */
export class ThreeWayMergeWorker implements IMergeWorker {
  readonly id = '3way-standard';

  constructor(
    private git: GitAdapter,
    private normalizer?: TextNormalizer,
  ) {}

  async execute(op: ShadowOperation, state: FileState): Promise<MergeResult> {
    const startTime = Date.now();

    try {
      // 1. Get Base (HEAD)
      const base = await this.git.show('HEAD', state.path);

      // 2. Get Theirs (AI Content)
      const theirs = op.content!;

      // 3. Get Ours (Working Tree)
      // We read from disk directly to ensure we have the latest content including unstaged changes
      const ours = await fs.readFile(state.path);

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
        error: `Three-way merge failed: ${error.message}`,
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

      // Use GitAdapter to execute merge-file
      // Note: GitAdapter.mergeFile implementation takes paths: base, current(ours), incoming(theirs)
      return await this.git.mergeFile(tempBase, tempOurs, tempTheirs);
    } finally {
      // Cleanup
      await Promise.all([
        fs.unlink(tempBase).catch(() => {}),
        fs.unlink(tempTheirs).catch(() => {}),
        fs.unlink(tempOurs).catch(() => {}),
      ]);
    }
  }
}
