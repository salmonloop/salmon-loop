import { createHash } from 'crypto';

import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { normalizeDiff, validateDiff, convertDiffToShadowOperations } from '../../diff.js';
import { DecisionEngine, DslContext, PlanBuilder } from '../../grizzco/dsl/DecisionEngine.js';
import { StandardStrategy } from '../../grizzco/dsl/strategies.js';
import { Executor } from '../../grizzco/execution/Executor.js';
import { WorkerFactory } from '../../grizzco/execution/WorkerFactory.js';
import { CachedService } from '../../grizzco/services/CachedService.js';
import { GitConfigService } from '../../grizzco/services/implementations/GitConfigService.js';
import { MockLockService } from '../../grizzco/services/implementations/MockLockService.js';
import { MockUserQuotaService } from '../../grizzco/services/implementations/MockUserQuotaService.js';
import { registry } from '../../grizzco/services/registry.js';
import { getRejectionsDir } from '../../runtime-paths.js';
import { FileStatus } from '../../shared/types/grizzco-types.js';
import { FileStateResolver } from '../../strata/layers/file-state-resolver.js';
import { ArtifactStore } from '../../sub-agent/artifacts/store.js';
import { Phase } from '../../types.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

function bootstrapRegistry(): void {
  if (!registry.has('remote_lock')) registry.register(new MockLockService());
  if (!registry.has('user_quota')) registry.register(new MockUserQuotaService());
  if (!registry.has('git_config')) registry.register(new CachedService(new GitConfigService()));
}

export const proposalApplySpec: Omit<ToolSpec, 'executor'> = {
  name: 'proposal.apply',
  source: 'builtin',
  description: text.tools.proposalApplyDescription,
  riskLevel: 'high',
  sideEffects: ['fs_write', 'git_write'],
  concurrency: 'serial_only',
  inputSchema: z.object({
    handle: z.string().describe('Patch artifact handle (s8p://artifact/<id>)'),
    snapshotRef: z
      .string()
      .optional()
      .describe('Optional snapshot/base ref for merge workers (defaults to HEAD)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    handle: z.string(),
    sha256: z.string(),
    changedFiles: z.array(z.string()),
    fileCount: z.number(),
    lineCount: z.number(),
    snapshotRef: z.string(),
    appliedFiles: z.number(),
    totalFiles: z.number(),
  }),
  allowedPhases: [Phase.VERIFY],
  summarizeArgsForAuthorization: async (args, _ctx) => {
    const handle = (args as any)?.handle as string | undefined;
    if (!handle) return undefined;

    const read = await ArtifactStore.readText(handle);
    if (!read.ok) return JSON.stringify({ handle, preview: 'artifact_not_found' });

    try {
      const normalized = normalizeDiff(read.content);
      const meta = validateDiff(normalized);
      const changedFiles = meta.changedFiles.slice(0, 20);
      return JSON.stringify({
        handle,
        fileCount: meta.fileCount,
        lineCount: meta.lineCount,
        changedFiles,
        changedFilesTruncated: meta.changedFiles.length > changedFiles.length,
      });
    } catch {
      return JSON.stringify({ handle, preview: 'invalid_diff' });
    }
  },
};

export async function executeProposalApply(
  input: z.infer<typeof proposalApplySpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  if (!ctx.worktreeRoot) {
    throw new Error(text.tools.worktreeRequired);
  }

  const read = await ArtifactStore.readText(input.handle);
  if (!read.ok) {
    throw new Error(text.tools.artifactNotFound(input.handle));
  }

  const normalized = normalizeDiff(read.content);
  const diffMeta = validateDiff(normalized);
  const sha256 = createHash('sha256').update(normalized, 'utf8').digest('hex');

  if (diffMeta.fileCount <= 0) {
    throw new Error(text.llm.patchEmpty());
  }

  bootstrapRegistry();

  const activePath = ctx.worktreeRoot || ctx.repoRoot;
  const persistenceRoot = ctx.persistenceRoot || ctx.repoRoot;

  const git = new GitAdapter(activePath);
  const resolver = new FileStateResolver(git, activePath);

  const workerFactory = new WorkerFactory(activePath);
  const executor = new Executor(workerFactory, getRejectionsDir(persistenceRoot));

  const operations = await convertDiffToShadowOperations(normalized);
  const paths = operations.map((op) => op.path);
  const stateMap = await resolver.getWorkspaceMap(paths);

  let appliedFiles = 0;

  for (const op of operations) {
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
      repoRoot: activePath,
      file: fileInfo as any,
      operation: op as any,
      options: {
        force: false,
        allowMM: true,
        safeMode: true,
        rejectDir: getRejectionsDir(persistenceRoot),
        dryRun: Boolean(ctx.dryRun),
        maxFileSize: 0,
      },
      snapshot: {
        exists: true,
        id: input.snapshotRef || 'HEAD',
        timestamp: Date.now(),
        path: '',
      },
      runtime: { needsRollback: false },
      data: {},
    };

    const toolCtxForServices: any = {
      workspace: {
        baseRepoPath: persistenceRoot,
        workPath: activePath,
        strategy: 'worktree',
      },
      options: {
        dryRun: Boolean(ctx.dryRun),
      },
      shadowInitialRef: input.snapshotRef || 'HEAD',
    };

    const fetchMissingData = async (keys: string[]) => {
      const fetchPromises = keys.map(async (key) => {
        const service = registry.get(key);
        if (!service) throw new Error(text.grizzco.unknownDataDependency(key));
        return { key, data: await service.fetch(toolCtxForServices, op.path) };
      });

      const results = await Promise.all(fetchPromises);
      if (!dslCtx.data) dslCtx.data = {};
      results.forEach(({ key, data }) => {
        dslCtx.data![key] = data;
      });
    };

    const MAX_DSL_RETRIES = 10;
    let dslRetries = 0;

    let plan: any;
    while (true) {
      if (dslRetries++ > MAX_DSL_RETRIES) {
        throw new Error(text.grizzco.microOrchestratorLoopStuck(op.path));
      }

      const planBuilder = new PlanBuilder<DslContext>();
      const engine = new DecisionEngine<DslContext>(dslCtx, planBuilder);
      StandardStrategy(engine);
      const built = engine.build();

      if (built.type === 'PLAN') {
        plan = built.plan;
        break;
      }

      if (built.type === 'NEED_DATA') {
        await fetchMissingData(built.keys);
        continue;
      }
    }

    if (plan.shouldAbort) {
      throw new Error(text.grizzco.planAborted(op.path, plan.abortReason || 'Unknown reason'));
    }

    const execResult = await executor.execute(plan, dslCtx);
    if (!execResult.success) {
      throw new Error(text.grizzco.executionFailed(op.path, execResult.error || 'Unknown error'));
    }

    if (execResult.actionTaken.startsWith('MERGE')) appliedFiles++;
  }

  return {
    ok: true,
    handle: input.handle,
    sha256,
    changedFiles: diffMeta.changedFiles,
    fileCount: diffMeta.fileCount,
    lineCount: diffMeta.lineCount,
    snapshotRef: input.snapshotRef || 'HEAD',
    appliedFiles,
    totalFiles: operations.length,
  };
}
