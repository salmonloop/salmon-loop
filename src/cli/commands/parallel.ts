import { resolveExtensions } from '../../core/extensions/index.js';
import { CheckpointManager } from '../../core/strata/checkpoint/manager.js';
import { WorkspaceManager } from '../../core/strata/layers/worktree.js';
import { createStandardToolstack } from '../../core/tools/loader.js';
import { InMemoryLockManager } from '../../core/tools/parallel/lock-manager.js';
import { PlanPersistence, type PersistedPlanState } from '../../core/tools/parallel/persistence.js';
import { ParallelScheduler } from '../../core/tools/parallel/scheduler.js';
import { createUiAuthorizationProvider } from '../authorization/provider.js';
import { text } from '../locales/index.js';
import { requestSelection } from '../ui/selection/bus.js';

import type { Command } from './types.js';

function summarizeParallelPlan(state: PersistedPlanState): {
  planId: string;
  label: string;
  description: string;
} {
  const planId = state.plan?.id || state.result?.planId || 'unknown';
  const blocked = state.result?.blockedApprovals?.length ?? 0;
  const failed = Boolean(state.result?.failed);
  const canceled = Boolean(state.result?.canceled);
  const nodeCount = state.plan?.nodes?.length ?? 0;

  let status = 'pending';
  if (failed) status = 'failed';
  else if (canceled) status = 'canceled';
  else if (blocked > 0) status = 'blocked';

  const updatedAt = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : 'unknown';
  const description = `${status}, blocked=${blocked}, nodes=${nodeCount}, updated=${updatedAt}`;
  return { planId, label: planId, description };
}

async function selectParallelPlanFromUi(
  title: string,
  plans: PersistedPlanState[],
): Promise<string | null> {
  const items = plans.map((state) => {
    const summary = summarizeParallelPlan(state);
    return { id: summary.planId, label: summary.label, description: summary.description };
  });

  const promptId = `parallel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return requestSelection({ id: promptId, title, items });
}

function parallelSubcommandHint(sub: string) {
  return text.cli.parallelSubcommandHint(sub);
}

export const parallelCommand: Command = {
  name: '/parallel',
  hidden: true,
  description: text.cli.commandParallel,
  getSuggestions: ({ input }) => {
    const trimmed = input.trimStart();
    const parts = trimmed.split(/\s+/);
    const argIndex = parts.length - 1;
    const currentPrefix = parts[argIndex] || '';

    if (argIndex === 1) {
      const subCommands = ['list', 'resume', 'delete'];
      const search = currentPrefix.toLowerCase();
      return subCommands
        .filter((s) => s.startsWith(search))
        .map((s) => ({ name: s, description: parallelSubcommandHint(s) }));
    }

    return [];
  },
  execute: async ({ emit, input, sessionManager, toolAuthorization }) => {
    const repoRoot = sessionManager.getCurrent().meta.repoPath;
    const args = input.trim().split(/\s+/).slice(1);
    const subCommand = (args[0] || 'list').toLowerCase();

    const plans = await PlanPersistence.listPendingOrBlocked(repoRoot);
    plans.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    if (subCommand === 'list') {
      if (plans.length === 0) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.parallelListEmpty,
          timestamp: new Date(),
        });
        return;
      }

      const picked = await selectParallelPlanFromUi(text.cli.parallelSelectTitle, plans);
      if (!picked) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.parallelCanceled,
          timestamp: new Date(),
        });
        return;
      }

      const state = await PlanPersistence.load(repoRoot, picked);
      if (!state) {
        emit({
          type: 'log',
          level: 'error',
          message: text.cli.parallelNotFound(picked),
          timestamp: new Date(),
        });
        return;
      }

      const summary = summarizeParallelPlan(state);
      emit({
        type: 'log',
        level: 'info',
        message: summary.description,
        timestamp: new Date(),
      });
      return;
    }

    if (subCommand === 'delete') {
      let planId: string | null | undefined = args[1];
      if (!planId) {
        if (plans.length === 0) {
          emit({
            type: 'log',
            level: 'info',
            message: text.cli.parallelListEmpty,
            timestamp: new Date(),
          });
          return;
        }
        planId = await selectParallelPlanFromUi(text.cli.parallelSelectTitle, plans);
      }

      if (!planId) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.parallelCanceled,
          timestamp: new Date(),
        });
        return;
      }

      await PlanPersistence.delete(repoRoot, planId);
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.parallelDeleted(planId),
        timestamp: new Date(),
      });
      return;
    }

    if (subCommand === 'resume') {
      let planId: string | null | undefined = args[1];
      if (!planId) {
        if (plans.length === 0) {
          emit({
            type: 'log',
            level: 'info',
            message: text.cli.parallelListEmpty,
            timestamp: new Date(),
          });
          return;
        }
        planId = await selectParallelPlanFromUi(text.cli.parallelSelectTitle, plans);
      }

      if (!planId) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.parallelCanceled,
          timestamp: new Date(),
        });
        return;
      }

      const state = await PlanPersistence.load(repoRoot, planId);
      if (!state) {
        emit({
          type: 'log',
          level: 'error',
          message: text.cli.parallelNotFound(planId),
          timestamp: new Date(),
        });
        return;
      }

      const checkpointManager = new CheckpointManager();
      const snapshot = await checkpointManager.createSafeSnapshot(repoRoot, [], 'Parallel resume');

      const workspace = await WorkspaceManager.setup(
        {
          instruction: 'Parallel plan resume',
          repoPath: repoRoot,
          strategy: 'worktree',
        },
        snapshot.commitHash,
        emit,
      );

      try {
        await checkpointManager.restoreToShadow(repoRoot, workspace.workPath, snapshot.commitHash);
        const authorizationProvider = createUiAuthorizationProvider({
          emit,
          config: toolAuthorization,
        });

        let extensionResolution;
        try {
          extensionResolution = await resolveExtensions({ repoRoot: workspace.baseRepoPath });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          emit({
            type: 'log',
            level: 'error',
            message: `Failed to resolve extensions: ${message}`,
            timestamp: new Date(),
          });
          return;
        }

        const toolstack = await createStandardToolstack({
          repoRoot: workspace.workPath,
          persistenceRoot: workspace.baseRepoPath,
          worktreeRoot: workspace.workPath,
          attemptId: 0,
          dryRun: false,
          authorizationProvider,
          authorizationMode: 'deferred',
          extensions: extensionResolution.resolved,
        });

        const scheduler = new ParallelScheduler(toolstack.router as any, new InMemoryLockManager());

        const phase = (state.runtime?.phase as any) || 'PATCH';
        const runtime = {
          repoRoot: workspace.workPath,
          worktreeRoot: workspace.workPath,
          persistenceRoot: workspace.baseRepoPath,
          attemptId: 0,
          dryRun: false,
          model: state.runtime?.model,
          phase,
        };

        const runSignal = new AbortController().signal;
        let result = await scheduler.run(state.plan, runtime as any, runSignal, {
          initialResults: state.result.nodeResults,
          resumeBlockedApprovals: true,
        });

        const canWaitForAuth = typeof (toolstack.router as any).waitForAuthorization === 'function';
        let resumeAttempts = 0;
        while (result.blockedApprovals.length > 0 && canWaitForAuth && !runSignal.aborted) {
          resumeAttempts++;
          if (resumeAttempts > 10) break;

          await Promise.all(
            result.blockedApprovals.map(async (a) => {
              await (toolstack.router as any).waitForAuthorization(a.nodeId, runSignal);
            }),
          );

          result = await scheduler.run(state.plan, runtime as any, runSignal, {
            initialResults: result.nodeResults,
            resumeBlockedApprovals: true,
          });
        }

        await PlanPersistence.save(workspace.baseRepoPath, state.plan, result, {
          repoRoot: workspace.workPath,
          worktreeRoot: workspace.workPath,
          persistenceRoot: workspace.baseRepoPath,
          phase,
          model: state.runtime?.model,
        });

        emit({
          type: 'log',
          level: result.failed ? 'warn' : 'info',
          message: text.cli.parallelResumed(planId, result.blockedApprovals.length, result.failed),
          timestamp: new Date(),
        });
        return;
      } finally {
        await WorkspaceManager.teardown(workspace, emit);
      }
    }

    emit({
      type: 'log',
      level: 'error',
      message: text.cli.parallelUsage,
      timestamp: new Date(),
    });
  },
};
