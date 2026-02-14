import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { logIgnoredError } from '../../observability/ignored-error.js';
import { StrataContentGuardian } from '../../strata/interaction/content-guardian.js';
import { StrataFileSystemProvider } from '../../strata/interaction/file-system-provider.js';
import { FileState, MergeResult, ShadowOperation } from '../domain/grizzco-types.js';

import { IMergeWorker } from './i-merge-worker.js';

/**
 * MM (Double Dirty) Three-Way Merge Worker
 * Use case: File has changes in BOTH Index and Worktree.
 *
 * Strategy: Optimistic Concurrency Control.
 *
 * Base: Snapshot T0 (The state when AI started thinking)
 * Ours: Current worktree (may have changed since T0)
 * Theirs: AI Content (V2 - based on T0)
 *
 * This allows merging AI changes (T0 -> AI) with the user's latest changes (T0 -> current).
 */
export class MMThreeWayWorker implements IMergeWorker {
  readonly id = '3way-mm-advanced';

  private guardian = new StrataContentGuardian();
  private fsProvider: StrataFileSystemProvider;

  constructor(private git: GitAdapter) {
    this.fsProvider = new StrataFileSystemProvider(git);
  }

  private async gitMergeFile(
    baseText: string,
    oursText: string,
    theirsText: string,
  ): Promise<{ content: Buffer; hasConflict: boolean }> {
    const tempDir = tmpdir();
    const id = randomBytes(4).toString('hex');
    const tempBase = path.join(tempDir, `s8p-mm-base-${id}`);
    const tempOurs = path.join(tempDir, `s8p-mm-ours-${id}`);
    const tempTheirs = path.join(tempDir, `s8p-mm-theirs-${id}`);

    try {
      await fs.writeFile(tempBase, baseText, 'utf8');
      await fs.writeFile(tempOurs, oursText, 'utf8');
      await fs.writeFile(tempTheirs, theirsText, 'utf8');

      return await this.git.mergeFile(tempBase, tempOurs, tempTheirs);
    } finally {
      await Promise.all([
        fs
          .unlink(tempBase)
          .catch((error) => logIgnoredError(`[MMThreeWayWorker] cleanup ${tempBase}`, error)),
        fs
          .unlink(tempOurs)
          .catch((error) => logIgnoredError(`[MMThreeWayWorker] cleanup ${tempOurs}`, error)),
        fs
          .unlink(tempTheirs)
          .catch((error) => logIgnoredError(`[MMThreeWayWorker] cleanup ${tempTheirs}`, error)),
      ]);
    }
  }

  async execute(
    op: ShadowOperation,
    state: FileState,
    context?: { snapshotId?: string },
  ): Promise<MergeResult> {
    const startTime = Date.now();

    if (!context?.snapshotId) {
      return {
        path: state.path,
        success: false,
        error: 'MM merge strategy requires snapshotId',
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }

    try {
      // 1. Get Base (Snapshot T0)
      const base = await this.git.show(context.snapshotId, state.path);

      // 2. Get Theirs (AI Content)
      const theirs = op.content!;

      // 3. Get Ours (Current Worktree) via Strata Safety Operator
      // Scenario D: Must read from disk to include unstaged changes
      const ours = await this.fsProvider.readYours(this.git.repoPath, state.path);

      if (!ours) {
        throw new Error(`Failed to read content for ${state.path} from disk`);
      }

      // 4. Content Safety Inspection (EOL & Binary)
      const baseInfo = this.guardian.inspect(base);
      const theirsInfo = this.guardian.inspect(theirs);
      const oursInfo = this.guardian.inspect(ours);

      if (baseInfo.isBinary || theirsInfo.isBinary || oursInfo.isBinary) {
        return {
          path: state.path,
          success: false,
          error: 'Cannot perform text merge on binary file',
          isConflict: false,
          workerId: this.id,
          executionTime: Date.now() - startTime,
        };
      }

      // 5. Perform Merge (Using Normalized Content)
      const merged = await this.gitMergeFile(
        baseInfo.normalized,
        oursInfo.normalized,
        theirsInfo.normalized,
      );

      // 6. Restore EOL (Using User's Disk Preference)
      const finalContent = this.guardian.restore(
        merged.content.toString('utf8'),
        oursInfo.eol, // Respect user's current EOL
      );

      return {
        path: state.path,
        success: !merged.hasConflict,
        mergedContent: Buffer.from(finalContent),
        isConflict: merged.hasConflict,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        path: state.path,
        success: false,
        error: `MM merge failed: ${error.message}`,
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }
  }
}
