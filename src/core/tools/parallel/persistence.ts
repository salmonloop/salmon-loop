import path from 'path';

import { syncFs as fs } from '../../adapters/fs/node-fs.js';
import type { ToolRuntimeCtx } from '../types.js';

import { ExecutionPlan, PlanRunResult } from './plan.js';

/**
 * Represents the persisted state of a parallel execution plan.
 */
export interface PersistedPlanState {
  /**
   * Persistence schema version (best-effort).
   * Older plan files may omit this field.
   */
  version?: number;
  plan: ExecutionPlan;
  result: PlanRunResult;
  /**
   * Runtime metadata for resuming/debugging outside of the original process.
   * This is best-effort and should be treated as advisory (paths may no longer exist).
   */
  runtime?: Pick<
    ToolRuntimeCtx,
    'repoRoot' | 'worktreeRoot' | 'persistenceRoot' | 'phase' | 'model'
  >;
  updatedAt: string;
}

/**
 * Persistence layer for parallel execution plans.
 * Supports saving, loading, and listing plans from the .salmonloop/parallel directory.
 */
export class PlanPersistence {
  /**
   * Gets the directory where parallel plans are stored.
   * @param repoRoot The absolute path to the repository root.
   */
  private static getPersistenceDir(repoRoot: string): string {
    return path.join(repoRoot, '.salmonloop', 'parallel');
  }

  /**
   * Saves a plan and its current result/state.
   * @param repoRoot The absolute path to the persistence root (usually the base repo).
   * @param plan The execution plan to save.
   * @param result The current result/state of the plan.
   * @param runtime Optional runtime metadata (best-effort, for resuming/debugging).
   */
  static async save(
    repoRoot: string,
    plan: ExecutionPlan,
    result: PlanRunResult,
    runtime?: PersistedPlanState['runtime'],
  ): Promise<void> {
    const dir = this.getPersistenceDir(repoRoot);
    await fs.mkdir(dir, { recursive: true });

    const state: PersistedPlanState = {
      version: 1,
      plan,
      result,
      runtime,
      updatedAt: new Date().toISOString(),
    };

    const filePath = path.join(dir, `${plan.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  /**
   * Loads a persisted plan state by its ID.
   * @param repoRoot The absolute path to the repository root.
   * @param planId The ID of the plan to load.
   */
  static async load(repoRoot: string, planId: string): Promise<PersistedPlanState | null> {
    const filePath = path.join(this.getPersistenceDir(repoRoot), `${planId}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as PersistedPlanState;
    } catch (_error) {
      if ((_error as any).code === 'ENOENT') {
        return null;
      }
      throw _error;
    }
  }

  /**
   * Lists all persisted plan states.
   * @param repoRoot The absolute path to the repository root.
   */
  static async listAll(repoRoot: string): Promise<PersistedPlanState[]> {
    const dir = this.getPersistenceDir(repoRoot);
    try {
      const files = await fs.readdir(dir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      const states: PersistedPlanState[] = [];
      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(path.join(dir, file), 'utf8');
          states.push(JSON.parse(content));
        } catch (_error) {
          // Skip malformed or unreadable files
          continue;
        }
      }
      return states;
    } catch (_error) {
      if ((_error as any).code === 'ENOENT') {
        return [];
      }
      throw _error;
    }
  }

  /**
   * Lists plans that are currently pending or blocked by approval.
   * @param repoRoot The absolute path to the repository root.
   */
  static async listPendingOrBlocked(repoRoot: string): Promise<PersistedPlanState[]> {
    const allStates = await this.listAll(repoRoot);
    return allStates.filter((state) => {
      // If it's explicitly failed or canceled, it's not pending/blocked
      if (state.result.failed || state.result.canceled) {
        return false;
      }

      // If there are blocked approvals, it's blocked
      if (state.result.blockedApprovals && state.result.blockedApprovals.length > 0) {
        return true;
      }

      // Check if any node results indicate it's not finished
      const results = Object.values(state.result.nodeResults);
      if (results.length === 0) {
        return true; // Empty plan or just started
      }

      const hasIncomplete = results.some(
        (r) =>
          r.status === 'PENDING' ||
          r.status === 'READY' ||
          r.status === 'RUNNING' ||
          r.status === 'BLOCKED_APPROVAL',
      );

      return hasIncomplete;
    });
  }

  /**
   * Deletes a persisted plan state.
   * @param repoRoot The absolute path to the repository root.
   * @param planId The ID of the plan to delete.
   */
  static async delete(repoRoot: string, planId: string): Promise<void> {
    const filePath = path.join(this.getPersistenceDir(repoRoot), `${planId}.json`);
    try {
      await fs.unlink(filePath);
    } catch (_error) {
      if ((_error as any).code !== 'ENOENT') {
        throw _error;
      }
    }
  }
}
