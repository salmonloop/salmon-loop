import { text } from '../../../locales/index.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { convertDiffToShadowOperations } from '../../patch/diff.js';
import { getRejectionsDir } from '../../runtime/paths.js';
import {
  FileStatus,
  type FileState,
  type GrizzcoOptions,
  type ShadowOperation,
} from '../domain/grizzco-types.js';
import type { DslContext, ExecutionPlan } from '../dsl/DecisionEngine.js';
import { MicroTaskRunner } from '../dsl/MicroTaskRunner.js';
import { StandardStrategy } from '../dsl/strategies.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { ApplyCtx, type ApplyDecision, AstValidateCtx } from '../engine/pipeline/types.js';
import { Executor, type ExecutionResult } from '../execution/Executor.js';
import { WorkerFactory } from '../execution/WorkerFactory.js';
import { CachedService } from '../services/CachedService.js';
import { GitConfigService } from '../services/implementations/default/GitConfigService.js';
import { MockLockService } from '../services/implementations/mock/MockLockService.js';
import { MockUserQuotaService } from '../services/implementations/mock/MockUserQuotaService.js';
import { registry } from '../services/registry.js';

/**
 * Bootstraps the service registry with required providers.
 */
export function bootstrapRegistry(): void {
  if (!registry.has('remote_lock')) registry.register(new MockLockService());
  if (!registry.has('user_quota')) registry.register(new MockUserQuotaService());
  if (!registry.has('git_config')) registry.register(new CachedService(new GitConfigService()));
}

export const runApply: Step<AstValidateCtx, ApplyCtx> = async (ctx) => {
  const { workspace, diff, fileStateResolver, emit } = ctx;

  bootstrapRegistry();
  const workerFactory = new WorkerFactory(workspace.workPath);
  const repoRoot = workspace.baseRepoPath || workspace.workPath;
  const executor = new Executor(workerFactory, getRejectionsDir(repoRoot));

  const operations = await convertDiffToShadowOperations(diff);
  const paths = operations.map((op) => op.path);
  const stateMap = await fileStateResolver.getWorkspaceMap(paths);

  const executionResults: ExecutionResult[] = [];
  const allDecisions: ApplyDecision[] = [];
  let successCount = 0;

  const dslOptions: Omit<GrizzcoOptions, 'operations'> = {
    force: false,
    allowMM: ctx.options.applyBackOnDirty === '3way',
    safeMode: true,
    rejectDir: getRejectionsDir(repoRoot),
    dryRun: Boolean(ctx.options.dryRun),
    maxFileSize: Number.MAX_SAFE_INTEGER,
    verbose: ctx.options.verbose,
  };

  const processOperation = async (op: ShadowOperation) => {
    const fileState = stateMap.get(op.path);
    const fileInfo: FileState & { hasConflict: boolean } = fileState
      ? { ...fileState, hasConflict: fileState.status === FileStatus.CONFLICT }
      : {
          path: op.path,
          status: FileStatus.CLEAN,
          isBinary: false,
          isSymlink: false,
          isIgnored: false,
          hasConflict: false,
          size: 0,
        };

    const dslCtx: DslContext = {
      repoRoot: workspace.workPath,
      file: fileInfo,
      operation: op,
      options: dslOptions,
      // NOTE:
      // - In worktree strategy, ctx.shadowInitialRef is a real snapshot commit hash (T0) and is required
      //   for MM (double-dirty) merges.
      // - In direct strategy (anchor deferred), we fall back to HEAD as a best-effort base revision
      //   so workers never attempt to resolve an invalid revision like "T0".
      snapshot: {
        exists: true,
        id: ctx.shadowInitialRef || 'HEAD',
        timestamp: Date.now(),
        path: '',
      },
      runtime: { needsRollback: false },
      data: {},
    };

    const microTaskRunner = new MicroTaskRunner<DslContext>({
      strategy: StandardStrategy,
      debugLabel: op.path,
      maxRounds: 10,
      resolveData: async (_microCtx, key) => {
        const service = registry.get(key);
        if (!service) throw new Error(text.grizzco.unknownDataDependency(key));
        return service.fetch(ctx, op.path);
      },
    });
    const microResult = await microTaskRunner.decide(dslCtx);
    const plan: ExecutionPlan = microResult.plan;

    allDecisions.push({
      path: op.path,
      decisions: microResult.decisions,
    });
    recordAuditEvent(
      'grizzco.apply.execution_plan',
      {
        path: op.path,
        workerId: plan.workerId || null,
        shouldAbort: plan.shouldAbort,
        actions: plan.actions,
        decisionTree: plan.decisionTree,
      },
      { source: 'grizzco', severity: 'low', scope: 'session', phase: 'APPLY' },
    );

    if (plan.shouldAbort) {
      throw new Error(text.grizzco.planAborted(op.path, plan.abortReason || 'Unknown reason'));
    }

    const execResult = await executor.execute(plan, dslCtx);
    executionResults.push(execResult);
    if (!execResult.success) {
      throw new Error(text.grizzco.executionFailed(op.path, execResult.error || 'Unknown error'));
    }
    if (execResult.actionTaken.startsWith('MERGE')) successCount++;
  };

  const CONCURRENCY = 5;
  for (let i = 0; i < operations.length; i += CONCURRENCY) {
    const batch = operations.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((op) => processOperation(op)));
  }

  emit({
    type: 'log',
    level: 'info',
    message: text.grizzco.transactionCompleted(successCount, operations.length),
    timestamp: new Date(),
  });

  return {
    ...ctx,
    applyResult: {
      success: true,
      results: executionResults,
      successCount,
      totalFiles: operations.length,
      decisions: allDecisions,
    },
  };
};
