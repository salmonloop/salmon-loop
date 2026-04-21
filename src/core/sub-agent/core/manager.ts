import { createHash, randomBytes } from 'crypto';

import { text } from '../../../locales/index.js';
import { createFileSystemAdapter } from '../../adapters/fs/index.js';
import * as fs from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { InitCtx } from '../../grizzco/engine/pipeline/types.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
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
import { isReadOnlySubAgentContext, resolveSubAgentDryRun } from '../dispatch-policy.js';
import { validateSharedPrefixConsistency } from '../prefix-consistency.js';
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
    const normalizedRequest =
      request.session_target === 'shared'
        ? (() => {
            const consistency = validateSharedPrefixConsistency({
              requestSnapshot: request.contextSnapshot,
              runtimeSnapshot: this.ctx.contextSnapshot,
            });
            if (consistency.compatible) return request;

            recordAuditEvent(
              'sub_agent.shared.prefix_consistency_failed',
              {
                metric: 'shared_fallback_rate',
                fallbackMode: 'isolated',
                reason: consistency.reason,
                expected: consistency.expected,
                actual: consistency.actual,
              },
              {
                source: 'smallfry',
                severity: 'medium',
                scope: 'session',
                phase: this.ctx.phase,
              },
            );
            return {
              ...request,
              session_target: 'isolated',
              contextSnapshot: undefined,
            } as SubAgentRequest;
          })()
        : request;
    const profile = this.deps.registry.get(normalizedRequest.agent_ref);

    if (!profile) {
      return this.fail(
        normalizedRequest.agent_ref,
        text.smallfry.errors.profileNotFound(normalizedRequest.agent_ref),
        'LOOP_FAILED',
      );
    }

    const agentId = `smallfry-${randomBytes(4).toString('hex')}`;
    const currentDepth = normalizedRequest.recursionDepth || 0;
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

      const effectiveDryRun = resolveSubAgentDryRun({
        parentDryRun: this.ctx.dryRun,
        flowMode: this.ctx.flowMode,
        phase: this.ctx.phase,
      });
      const runtimeEnv = await this.setupIsolatedEnvironment(
        normalizedRequest,
        llm,
        agentId,
        effectiveDryRun,
      );

      try {
        const workspace = runtimeEnv.workspace!;

        const activePath = workspace.workPath;

        const git = new GitAdapter(activePath);
        const resolver = new FileStateResolver(git, activePath);
        const flowMode = 'patch' as const;
        const fsAdapter = createFileSystemAdapter(flowMode);

        // 2. Construct InitCtx for the smallfry
        const initCtx = this.applyContextSnapshot(normalizedRequest.contextSnapshot, {
          workspace: {
            workPath: activePath,
            baseRepoPath: workspace.baseRepoPath,
            strategy: workspace.strategy,
          },
          options: {
            instruction: normalizedRequest.task,
            repoPath: activePath,
            dryRun: effectiveDryRun,
            contextFiles: normalizedRequest.contextFiles || [],
            llm,
            recursionDepth: currentDepth + 1, // Increment depth for child
            allowedToolNames: this.filterAllowedTools(profile.allowedTools, this.ctx.phase),
            timeoutMs: normalizedRequest.timeout_seconds
              ? normalizedRequest.timeout_seconds * 1000
              : profile.timeoutMs,
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
      replacementState: normalized.replacementState ?? initCtx.replacementState,
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
    effectiveDryRun: boolean,
  ): Promise<SubAgentRuntimeEnvironment> {
    if (
      isReadOnlySubAgentContext({
        flowMode: this.ctx.flowMode,
        phase: this.ctx.phase,
      }) &&
      request.session_target !== 'isolated'
    ) {
      recordAuditEvent(
        'sub_agent.dispatch.read_only_forced_isolated',
        {
          requestedSessionTarget: request.session_target,
          effectiveSessionTarget: 'isolated',
        },
        {
          source: 'smallfry',
          severity: 'low',
          scope: 'session',
          phase: this.ctx.phase,
        },
      );
    }

    const baseRepoPath = this.ctx.persistenceRoot || this.ctx.repoRoot;
    const options: LoopOptions = {
      instruction: request.task,
      repoPath: baseRepoPath,
      llm,
      // CRITICAL SAFETY: read-only model phases force sub-agent dryRun.
      dryRun: effectiveDryRun,
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

  private filterAllowedTools(allowed: string[], phase: ToolRuntimeCtx['phase']): string[] {
    const safeReadOnlyTools = new Set<string>([
      'agent_dispatch',
      'code.search',
      'code.ast',
      'fs.read',
      'git.status',
      'git.cat',
      'artifact.read',
    ]);

    const readOnlyPlanTools = new Set<string>(['plan.init', 'plan.read', 'plan.update']);
    const readOnlyPhase = isReadOnlySubAgentContext({
      flowMode: this.ctx.flowMode,
      phase,
    });
    if (!readOnlyPhase) {
      return allowed;
    }

    const filtered = allowed.filter(
      (name) => safeReadOnlyTools.has(name) || (readOnlyPhase && readOnlyPlanTools.has(name)),
    );

    if (readOnlyPhase) {
      const removed = allowed.filter((name) => !filtered.includes(name));
      if (removed.length > 0) {
        recordAuditEvent(
          'sub_agent.dispatch.read_only_tool_guard_filtered',
          {
            removedTools: removed,
            retainedTools: filtered,
          },
          {
            source: 'smallfry',
            severity: 'medium',
            scope: 'session',
            phase,
          },
        );
      }
    }

    return filtered;
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
