import { Buffer } from 'node:buffer';
import * as path from 'path';

import * as fs from '../../adapters/fs/node-fs.js';
import { FileState, MergeResult, ShadowOperation } from '../domain/grizzco-types.js';

import { IMergeWorker } from './i-merge-worker.js';

/**
 * Union Merge Worker
 * Use case: Force append mode for safe file types.
 * Strategy:
 * 1. For safe types (.md, .txt, .log): Append content with a separator.
 * 2. For code files: Reject (return conflict) to force .rej generation.
 */
export class UnionMergeWorker implements IMergeWorker {
  readonly id = 'union-merge-safe';

  // Safe extension whitelist
  private readonly SAFE_EXTENSIONS = new Set(['.md', '.txt', '.log', '.csv']);

  async execute(
    op: ShadowOperation,
    state: FileState,
    context?: { repoRoot?: string },
  ): Promise<MergeResult> {
    const startTime = Date.now();
    const ext = path.extname(state.path).toLowerCase();

    // 1. Check if extension is safe for union merge
    if (!this.SAFE_EXTENSIONS.has(ext)) {
      return {
        path: state.path,
        success: false,
        error:
          'Code files do not support forced append. Please resolve conflicts manually via .rej files.',
        isConflict: true, // Treat as conflict to trigger .rej generation
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }

    // 2. Perform append
    try {
      let current: Buffer;
      if (state.workingContent) {
        current = state.workingContent;
      } else {
        const repoRoot = context?.repoRoot;
        if (!repoRoot) {
          throw new Error('repoRoot context is required for union-merge reading');
        }
        const fullPath = path.join(repoRoot, state.path);
        // 🛡️ REFACTOR: Join with repoRoot to ensure sandboxed reading
        current = await fs.readFile(fullPath);
      }

      const incoming = op.content!;

      const merged = Buffer.concat([
        current,
        Buffer.from('\n\n<!-- === AI Generated Content === -->\n'),
        incoming,
      ]);

      return {
        path: state.path,
        success: true,
        mergedContent: merged,
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    } catch (error: unknown) {
      return {
        path: state.path,
        success: false,
        error: `Union merge failed: ${error instanceof Error ? error.message : String(error)}`,
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }
  }
}
