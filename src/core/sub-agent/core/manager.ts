import { createHash, randomBytes } from 'crypto';

import { text } from '../../../locales/index.js';
import { createFileSystemAdapter } from '../../adapters/fs/index.js';
import * as fs from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { InitCtx } from '../../grizzco/engine/pipeline/types.js';
import { getLogger } from '../../observability/logger.js';
import { FileStateResolver } from '../../strata/layers/file-state-resolver.js';
import { RuntimeEnvironment } from '../../strata/runtime/environment.js';
import type { ToolRuntimeCtx } from '../../tools/types.js';
import type { LLM, LoopOptions } from '../../types/index.js';
import { ErrorType } from '../../types/index.js';
import type { ExecutionWorkspace } from '../../types/loop.js';
import { ArtifactStore } from '../artifacts/store.js';
import { cloneSubAgentContextSnapshot } from '../context-snapshot.js';
import type { SubAgentControllerPort } from '../controller.js';
import { resolveSubAgentDryRun } from '../dispatch-policy.js';
import type { SubAgentRegistry } from '../registry.js';
import { getSubAgentRegistry } from '../registry.js';
import type {
  IExecutable,
  SubAgentContextSnapshot,
  SubAgentProfile,
  SubAgentRequest,
  SubAgentResult,
  SubAgentStatus,
} from '../types.js';

import { SmallfryLoop } from './loop.js';

export type SubAgentRuntimeEnvironment = {
  setup(): Promise<void>;
  teardown(): Promise<void>;
  workspace?: ExecutionWorkspace;
  initialSnapshotHash?: string;
};

export type CreateSubAgentRuntimeEnvironment = (
  options: LoopOptions,
  emit: (event: any) => void,
) => SubAgentRuntimeEnvironment;

export type SubAgentManagerDeps = {
  registry: Pick<SubAgentRegistry, 'get'>;
  createRuntimeEnvironment: CreateSubAgentRuntimeEnvironment;
  artifactStore: Pick<typeof ArtifactStore, 'saveText'>;
};

/**
 * SubAgentManager coordinates the lifecycle of Smallfrys.
 * It handles profile resolution, budget monitoring, and result aggregation.
 */
export class SubAgentManager implements IExecutable<SubAgentRequest, SubAgentResult> {
  private activeAgents = new Map<string, { profile: SubAgentProfile; status: SubAgentStatus }>();
  private readonly deps: SubAgentManagerDeps;

  constructor(
    private ctx: ToolRuntimeCtx,
    private readonly controller: SubAgentControllerPort,
    deps?: Partial<SubAgentManagerDeps>,
  ) {
    this.deps = {
      registry: deps?.registry ?? getSubAgentRegistry(),
      createRuntimeEnvironment:
        deps?.createRuntimeEnvironment ??
        ((options, emit) => new RuntimeEnvironment(options, emit)),
      artifactStore: deps?.artifactStore ?? ArtifactStore,
    };
  }

  /**
   * Spawns a new sub-agent and monitors its execution.
   */
  async execute(request: SubAgentRequest): Promise<SubAgentResult> {
    const profile = this.deps.registry.get(request.agent_ref);

    if (!profile) {
      return this.fail(
        request.agent_ref,
        text.smallfry.errors.profileNotFound(request.agent_ref),
        'LOOP_FAILED',
      );
    }

    const agentId = `smallfry-${randomBytes(4).toString('hex')}`;
    const currentDepth = request.recursionDepth || 0;
    const MAX_RECURSION_DEPTH = 2;

    if (currentDepth >= MAX_RECURSION_DEPTH) {
      const msg = text.smallfry.errors.recursionLimitExceeded(currentDepth, MAX_RECURSION_DEPTH);
      getLogger().error(`[SubAgentManager] ${msg}`);
      return this.fail(profile.id, msg, 'LOOP_FAILED');
    }

    this.activeAgents.set(agentId, { profile, status: 'hiring' });
    this.controller.registerAgent(agentId, profile, 'hiring');

    getLogger().info(
      `[SubAgentManager] ${text.smallfry.status.spawning} (ID: ${agentId}, Role: ${profile.role})`,
    );

    const llm = this.ctx.llm;
    if (!llm) {
      const msg = text.smallfry.errors.dispatchMissingRuntimeLlm;
      getLogger().error(`[SubAgentManager] ${msg}`);
      return this.fail(profile.id, msg, 'LOOP_CRASH');
    }

    try {
      this.updateStatus(agentId, 'working');
      if (this.controller.isStopRequested(agentId)) {
        throw new Error('Stop requested before launching Smallfry');
      }

      const runtimeEnv = await this.setupIsolatedEnvironment(request, llm, agentId);

      try {
        const workspace = runtimeEnv.workspace!;

        const activePath = workspace.workPath;

        const git = new GitAdapter(activePath);
        const resolver = new FileStateResolver(git, activePath);
        const flowMode = 'patch' as const;
        const fsAdapter = createFileSystemAdapter(flowMode);

        // 2. Construct InitCtx for the smallfry
        const initCtx = this.applyContextSnapshot(request.contextSnapshot, {
          workspace: {
            workPath: activePath,
            baseRepoPath: workspace.baseRepoPath,
            strategy: workspace.strategy,
          },
          options: {
            instruction: request.task,
            repoPath: activePath,
            dryRun: this.ctx.dryRun,
            contextFiles: request.contextFiles || [],
            llm,
            recursionDepth: currentDepth + 1, // Increment depth for child
            allowedToolNames: this.filterAllowedTools(profile.allowedTools),
            timeoutMs: request.timeout_seconds ? request.timeout_seconds * 1000 : profile.timeoutMs,
          },
          mode: flowMode,
          fs: fsAdapter,
          emit: (event) => {
            // Bridge status to parent/UI
            if (event.type === 'phase.start') {
              this.updateStatus(agentId, 'working');
            }
            if (event.type === 'log') {
              getLogger().debug(`[Smallfry:${agentId}] ${event.level}: ${event.message}`);
            } else {
              getLogger().debug(`[Smallfry:${agentId}] ${event.type}`);
            }
          },
          fileStateResolver: resolver,
          shadowInitialRef: runtimeEnv?.initialSnapshotHash || 'HEAD',
        });

        // 3. Launch the "Little Fry"
        const subLoop = new SmallfryLoop(profile);
        const result = await subLoop.execute(initCtx);

        return await this.persistArtifacts(agentId, result);
      } finally {
        await runtimeEnv.teardown();
      }
    } catch (error: unknown) {
      this.controller.appendLog(
        agentId,
        `Execution failed: ${(error instanceof Error ? error.message : undefined) ?? error}`,
      );
      getLogger().error(
        `[SubAgentManager] Smallfry ${agentId} crashed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        agent_ref: profile.id,
        success: false,
        summary: text.smallfry.errors.missionFailedWithReason(
          error instanceof Error ? error.message : String(error),
        ),
        tokenUsage: 0,
        reason: error instanceof Error ? error.message : String(error),
        reasonCode: 'LOOP_CRASH',
        attempts: 1,
        logs: [],
        errorType: ErrorType.UNKNOWN,
      };
    } finally {
      this.activeAgents.delete(agentId);
    }
  }

  // Backward compatibility for internal calls
  async spawn(request: SubAgentRequest): Promise<SubAgentResult> {
    return this.execute(request);
  }

  private applyContextSnapshot(
    snapshot: SubAgentContextSnapshot | undefined,
    initCtx: InitCtx,
  ): InitCtx {
    const normalized = cloneSubAgentContextSnapshot(snapshot);
    if (!normalized) return initCtx;

    return {
      ...initCtx,
      cacheSharing: normalized.cacheSharing ?? initCtx.cacheSharing,
      planRuntime: normalized.planRuntime ?? initCtx.planRuntime,
      toolCallingAudit: normalized.toolCallingAudit ?? initCtx.toolCallingAudit,
      artifactHints: normalized.artifactHints ?? initCtx.artifactHints,
      options: {
        ...initCtx.options,
        conversationContext: normalized.conversationContext ?? initCtx.options.conversationContext,
      },
    };
  }

  private updateStatus(id: string, status: SubAgentStatus) {
    const entry = this.activeAgents.get(id);
    if (entry) {
      entry.status = status;
      getLogger().debug(`[SubAgentManager] Smallfry ${id} status: ${status}`);
      this.controller.updateStatus(id, status);
    }
  }

  private fail(
    agentRef: string,
    reason: string,
    reasonCode: SubAgentResult['reasonCode'],
  ): SubAgentResult {
    return {
      agent_ref: agentRef,
      success: false,
      summary: reason,
      tokenUsage: 0,
      reason,
      reasonCode,
      attempts: 1,
      logs: [],
      errorType: ErrorType.UNKNOWN,
    };
  }

  private async setupIsolatedEnvironment(
    request: SubAgentRequest,
    llm: LLM,
    agentId: string,
  ): Promise<SubAgentRuntimeEnvironment> {
    const baseRepoPath = this.ctx.persistenceRoot || this.ctx.repoRoot;
    const options: LoopOptions = {
      instruction: request.task,
      repoPath: baseRepoPath,
      llm,
      // CRITICAL SAFETY: read-only model phases force sub-agent dryRun.
      dryRun: resolveSubAgentDryRun(this.ctx.dryRun, this.ctx.phase),
      verify: undefined,
      strategy: 'worktree',
      contextFiles: request.contextFiles,
      agentKind: 'subagent',
    };
    const env = this.deps.createRuntimeEnvironment(options, (event) => {
      if (event.type === 'log') {
        getLogger().debug(`[Smallfry:${agentId}] ${event.level}: ${event.message}`);
      }
    });

    try {
      await env.setup();
      return env;
    } catch (error) {
      try {
        await env.teardown();
      } catch (teardownError) {
        getLogger().warn(
          `[SubAgentManager] Failed to teardown isolated environment after setup error: ${teardownError instanceof Error ? teardownError.message : String(teardownError)}`,
        );
      }
      throw error;
    }
  }

  private async persistArtifacts(agentId: string, result: SubAgentResult): Promise<SubAgentResult> {
    const patch = result.finalPatch;
    if (!patch || typeof patch !== 'string') return result;

    const saved = await this.deps.artifactStore.saveText({
      content: patch,
      mimeType: 'text/x-diff',
      fileExt: 'patch',
    });

    const { finalPatch: _ignored, ...rest } = result as any;
    const auditArtifact = await this.persistAuditArtifact(rest.auditPath);
    return {
      ...rest,
      auditPath: auditArtifact?.handle ?? rest.auditPath,
      auditArtifact: auditArtifact ?? undefined,
      patchArtifact: saved,
    };
  }

  private filterAllowedTools(allowed: string[]): string[] {
    const safeReadOnlyTools = new Set<string>([
      'agent_dispatch',
      'code.search',
      'code.ast',
      'fs.read',
      'git.status',
      'git.cat',
      'artifact.read',
    ]);

    return allowed.filter((name) => safeReadOnlyTools.has(name));
  }

  private async persistAuditArtifact(auditPath: unknown) {
    if (!auditPath || typeof auditPath !== 'string') return undefined;
    if (auditPath.startsWith('s8p://artifact/')) {
      const read = await ArtifactStore.readText(auditPath);
      if (!read.ok) return undefined;

      const sha256 = createHash('sha256').update(read.content, 'utf8').digest('hex');
      return {
        handle: auditPath,
        mimeType: 'application/json',
        sha256,
        size: read.size,
      };
    }

    try {
      const content = await fs.readFile(auditPath, 'utf8');
      return await ArtifactStore.saveText({
        content,
        mimeType: 'application/json',
        fileExt: 'json',
      });
    } catch {
      return undefined;
    }
  }
}
