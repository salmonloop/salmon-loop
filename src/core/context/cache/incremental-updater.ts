/**
 * Incremental context updater.
 *
 * Computes diffs between context versions and applies incremental updates.
 */

import type { Context } from '../../types/index.js';

/**
 * Context diff between two versions.
 */
export interface ContextDiff {
  /** Added file paths */
  addedFiles: string[];
  /** Removed file paths */
  removedFiles: string[];
  /** Modified file paths */
  modifiedFiles: string[];
  /** Token delta */
  tokenDelta: number;
  /** Whether primary text changed */
  primaryChanged: boolean;
  /** Whether snippets changed */
  snippetsChanged: boolean;
  /** Whether diffs changed */
  diffsChanged: boolean;
}

/**
 * Incremental context updater.
 *
 * Tracks changes between context versions for efficient updates.
 */
export class IncrementalUpdater {
  private previousContext: Context | null = null;
  private previousTokenCount = 0;

  /**
   * Compute diff between previous and new context.
   */
  computeDiff(newContext: Context): ContextDiff {
    const diff: ContextDiff = {
      addedFiles: [],
      removedFiles: [],
      modifiedFiles: [],
      tokenDelta: 0,
      primaryChanged: false,
      snippetsChanged: false,
      diffsChanged: false,
    };

    if (!this.previousContext) {
      // First context, everything is new
      if (newContext.relatedFiles) {
        diff.addedFiles = newContext.relatedFiles.map((f) => f.path);
      }
      diff.primaryChanged = !!newContext.primaryText;
      diff.snippetsChanged = newContext.rgSnippets.length > 0;
      diff.diffsChanged = !!(newContext.gitDiff || newContext.stagedDiff);

      this.previousContext = newContext;
      return diff;
    }

    // Compare related files
    const prevFiles = new Map(
      (this.previousContext.relatedFiles || []).map((f) => [f.path, f.content]),
    );
    const newFiles = new Map((newContext.relatedFiles || []).map((f) => [f.path, f.content]));

    // Find added and modified files
    for (const [path, content] of newFiles) {
      const prevContent = prevFiles.get(path);
      if (!prevContent) {
        diff.addedFiles.push(path);
      } else if (prevContent !== content) {
        diff.modifiedFiles.push(path);
      }
    }

    // Find removed files
    for (const path of prevFiles.keys()) {
      if (!newFiles.has(path)) {
        diff.removedFiles.push(path);
      }
    }

    // Check primary text
    diff.primaryChanged = this.previousContext.primaryText !== newContext.primaryText;

    // Check snippets
    diff.snippetsChanged = this.hasSnippetsChanged(
      this.previousContext.rgSnippets,
      newContext.rgSnippets,
    );

    // Check diffs
    diff.diffsChanged =
      this.previousContext.gitDiff !== newContext.gitDiff ||
      this.previousContext.stagedDiff !== newContext.stagedDiff ||
      this.previousContext.unstagedDiff !== newContext.unstagedDiff ||
      this.previousContext.untrackedDiff !== newContext.untrackedDiff;

    // Update previous context
    this.previousContext = newContext;

    return diff;
  }

  /**
   * Check if snippets changed.
   */
  private hasSnippetsChanged(prev: Context['rgSnippets'], current: Context['rgSnippets']): boolean {
    if (prev.length !== current.length) return true;

    for (let i = 0; i < prev.length; i++) {
      if (
        prev[i].file !== current[i].file ||
        prev[i].content !== current[i].content ||
        prev[i].line !== current[i].line
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Set token count for delta calculation.
   */
  setTokenCount(count: number): void {
    this.previousTokenCount = count;
  }

  /**
   * Get previous token count.
   */
  getPreviousTokenCount(): number {
    return this.previousTokenCount;
  }

  /**
   * Reset state.
   */
  reset(): void {
    this.previousContext = null;
    this.previousTokenCount = 0;
  }

  /**
   * Get previous context.
   */
  getPreviousContext(): Context | null {
    return this.previousContext;
  }
}

/**
 * Global incremental updater instance.
 */
let globalInstance: IncrementalUpdater | null = null;

/**
 * Get global incremental updater.
 */
export function getIncrementalUpdater(): IncrementalUpdater {
  if (!globalInstance) {
    globalInstance = new IncrementalUpdater();
  }
  return globalInstance;
}

/**
 * Reset global instance (for testing).
 */
export function resetIncrementalUpdater(): void {
  globalInstance = null;
}
