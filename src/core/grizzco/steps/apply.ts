import { text } from '../../../locales/index.js';
import { convertDiffToShadowOperations } from '../../diff.js';
import { FileStatus } from '../../shared/types/grizzco-types.js';
import { DecisionEngine, DslContext, PlanBuilder } from '../dsl/DecisionEngine.js';
import { StandardStrategy } from '../dsl/strategies.js';
import { Executor } from '../execution/Executor.js';
import { WorkerFactory } from '../execution/WorkerFactory.js';
import { Step } from '../pipeline.js';
import { CachedService } from '../services/CachedService.js';
import { GitConfigService } from '../services/implementations/GitConfigService.js';
import { MockLockService } from '../services/implementations/MockLockService.js';
import { MockUserQuotaService } from '../services/implementations/MockUserQuotaService.js';
import { registry } from '../services/registry.js';
import { ApplyCtx, AstValidateCtx } from '../types.js';

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
  const executor = new Executor(workerFactory, '.s8p/rejections');

  const operations = await convertDiffToShadowOperations(diff);
  const paths = operations.map((op) => op.path);
  const stateMap = await fileStateResolver.getWorkspaceMap(paths);

  const executionResults: any[] = [];
  const allDecisions: any[] = [];
  let successCount = 0;

  const processOperation = async (op: any) => {
    const fileState = stateMap.get(op.path);
    const fileInfo = fileState
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
      options: ctx.options,
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

    let plan;
    let finalEngine: DecisionEngine | undefined;

    const fetchMissingData = async (keys: string[]) => {
      const fetchPromises = keys.map(async (key) => {
        const service = registry.get(key);
        if (!service) throw new Error(text.grizzco.unknownDataDependency(key));
        return { key, data: await service.fetch(ctx, op.path) };
      });

      const results = await Promise.all(fetchPromises);
      if (!dslCtx.data) dslCtx.data = {};
      results.forEach(({ key, data }) => {
        dslCtx.data![key] = data;
      });
    };

    const MAX_DSL_RETRIES = 10;
    let dslRetries = 0;

    while (true) {
      if (dslRetries++ > MAX_DSL_RETRIES) {
        throw new Error(text.grizzco.microOrchestratorLoopStuck(op.path));
      }
      const planBuilder = new PlanBuilder<DslContext>();
      const engine = new DecisionEngine<DslContext>(dslCtx, planBuilder);
      finalEngine = engine;

      StandardStrategy(engine);
      const result = engine.build();

      if (result.type === 'PLAN') {
        plan = result.plan;
        break;
      }

      if (result.type === 'NEED_DATA') {
        await fetchMissingData(result.keys);
        continue;
      }
    }

    if (finalEngine) {
      allDecisions.push({ path: op.path, decisions: finalEngine.getStructuredDecisions() });
    }

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
