import { randomBytes } from 'crypto';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';

import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { FileState, FileStatus, MergeResult, ShadowOperation } from '../domain/grizzco-types.js';

import { IMergeWorker } from './i-merge-worker.js';

/**
 * Git Apply Worker
 * 🛡️ DATA INTEGRITY GUARDIAN:
 * This worker uses the native 'git apply --3way' engine.
 * It is the ONLY safe way to apply incremental patches to existing files
 * without risking full-file truncation.
 */
export class GitApplyWorker implements IMergeWorker {
  readonly id = 'git-apply';

  constructor(private readonly workPath: string) {}

  async execute(op: ShadowOperation, state: FileState): Promise<MergeResult> {
    const startTime = Date.now();
    const git = new GitAdapter(this.workPath);
    const tmpIndex = path.join(tmpdir(), `s8p-idx-${Date.now()}-${randomBytes(4).toString('hex')}`);
    const env = { GIT_INDEX_FILE: tmpIndex };

    try {
      if (!op.content) {
        throw new Error('Patch content is empty');
      }

      const diffText = op.content.toString('utf8');

      // git apply --3way may consult the index for base blobs. In MM state, the index and working tree differ,
      // which can trigger "does not match index" even for safe patches. We use a temporary index that matches
      // the current working tree for the target path to keep the real index untouched.
      const useTempIndex = state.status === FileStatus.MM;

      if (useTempIndex) {
        await git.exec(['read-tree', 'HEAD'], { env });
        await git.exec(['add', '--', state.path], { env });
      }

      // applyPatch handles writing a temp patch file and running git apply
      await git.applyPatch(diffText, {
        threeWay: true,
        ignoreWhitespace: true,
        env: useTempIndex ? env : undefined,
      });

      return {
        path: state.path,
        success: true,
        // For git-apply, the changes are applied directly to the filesystem.
        // We return empty mergedContent because the result is already on disk,
        // but success is true to indicate the transaction was successful.
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        path: state.path,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    } finally {
      await rm(tmpIndex, { force: true }).catch(() => {});
    }
  }
}
