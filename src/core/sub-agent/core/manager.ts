import { createHash, randomBytes } from 'crypto';

import { text } from '../../../locales/index.js';
import { createFileSystemAdapter } from '../../adapters/fs/index.js';
import * as fs from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import type { InitCtx } from '../../grizzco/engine/pipeline/types.js';
import { createTaskEventBus, type TaskEventBus } from '../../interaction/events/bus.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { getLogger } from '../../observability/logger.js';
import { FileStateResolver } from '../../strata/layers/file-state-resolver.js';
import { RuntimeEnvironment } from '../../strata/runtime/environment.js';
import type { ToolRuntimeCtx } from '../../tools/types.js';
import type { LLM, LoopOptions } from '../../types/index.js';
import { ErrorType } from '../../types/index.js';
import type { ExecutionWorkspace } from '../../types/loop.js';
import { errorMessage } from '../../utils/error.js';
import { ArtifactStore } from '../artifacts/store.js';
import { cloneSubAgentContextSnapshot } from '../context-snapshot.js';
import type { SubAgentControllerPort } from '../controller.js';
import { isReadOnlySubAgentContext, resolveSubAgentDryRun } from '../dispatch-policy.js';
import { validateSharedPrefixConsistency } from '../prefix-consistency.js';
import type { SubAgentRegistry } from '../registry.js';
import { getSubAgentRegistry } from '../registry.js';
import { generateSubAgentSummary, formatSubAgentSummary } from '../summary.js';
import type { SubAgentSummary } from '../summary.js';
import type {
  IExecutable,
  SubAgentContextSnapshot,
  SubAgentHandle,
  SubAgentLlmFactory,
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
  eventBus: TaskEventBus;
  llmFactory?: SubAgentLlmFactory;
  /**
   * Optional callback fired when an async sub-agent completes.
   * Used for background auto-notify: the host can inject a system message
   * into the conversation when a background agent finishes.
   */
  onSubAgentComplete?: (agentId: string, result: unknown) => void;
};

/**
 * SubAgentManager coordinates the lifecycle of Smallfrys.
 * It handles profile resolution, budget monitoring, and result aggregation.
 */
export class SubAgentManager implements IExecutable<
  SubAgentRequest,
  SubAgentResult | SubAgentHandle
> {
  private activeAgents = new Map<
    string,
    { profile: SubAgentProfile; status: SubAgentStatus; result?: SubAgentResult }
  >();
  private completedResults: Array<{ agentId: string; result: SubAgentResult }> = [];
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
      eventBus: deps?.eventBus ?? createTaskEventBus(),
      llmFactory: deps?.llmFactory,
      onSubAgentComplete: deps?.onSubAgentComplete,
    };
  }

  /**
   * Spawns a new sub-agent. When request.async is true, returns a handle immediately;
   * otherwise blocks until the sub-agent completes.
   */
  async execute(request: SubAgentRequest): Promise<SubAgentResult | SubAgentHandle> {
    const normalizedRequest = this.normalizeRequest(request);
    const profile = this.deps.registry.get(normalizedRequest.agent_ref);

    if (!profile) {
      return this.fail(
        normalizedRequest.agent_ref,
        text.smallfry.errors.profileNotFound(normalizedRequest.agent_ref),
        'LOOP_FAILED',
      );
    }

    const agentId = `smallfry-${randomBytes(4).toString('hex')}`;

    if (normalizedRequest.async) {
      return this.executeAsync(normalizedRequest, profile, agentId);
    }
    return this.executeSync(normalizedRequest, profile, agentId);
  }

  /**
   * Waits for an async sub-agent to complete and returns its result.
   * @param handle - The sub-agent handle returned by executeAsync
   * @param timeoutMs - Maximum time to wait in milliseconds. Defaults to 300_000 (5 minutes).
   */
  async awaitResult(handle: SubAgentHandle, timeoutMs?: number): Promise<SubAgentResult> {
    // Check if already completed
    const entry = this.activeAgents.get(handle.agentId);
    if (entry?.result) {
      return entry.result;
    }

    // Check historical events
    const historical = this.deps.eventBus.list(handle.taskId, { limit: 10 });
    const terminalEvent = historical.find(
      (e) => e.type === 'subagent.completed' || e.type === 'subagent.failed',
    );
    if (terminalEvent) {
      return terminalEvent.state === 'completed'
        ? (terminalEvent.result as SubAgentResult)
        : this.fail(handle.agentId, terminalEvent.reason ?? 'Sub-agent failed', 'LOOP_FAILED');
    }

    const effectiveTimeout = timeoutMs ?? 300_000;

    // Subscribe and wait for terminal event
    return new Promise<SubAgentResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsub();
        // Request stop on the sub-agent so it can clean up
        this.controller.requestStop(handle.agentId);
        reject(
          new Error(
            `Timed out waiting for sub-agent ${handle.agentId} after ${effectiveTimeout}ms`,
          ),
        );
      }, effectiveTimeout);

      const unsub = this.deps.eventBus.subscribe((event) => {
        if (event.taskId !== handle.taskId) return;
        if (event.type === 'subagent.completed' || event.type === 'subagent.failed') {
          clearTimeout(timeout);
          unsub();
          if (event.type === 'subagent.completed') {
            resolve(event.result as SubAgentResult);
          } else {
            resolve(this.fail(handle.agentId, event.reason ?? 'Sub-agent failed', 'LOOP_FAILED'));
          }
        }
      });
    });
  }

  /**
   * Get a summary of all completed sub-agent results.
   * Includes conflict detection across patches.
   */
  getSummary(): SubAgentSummary | null {
    if (this.completedResults.length === 0) return null;
    return generateSubAgentSummary(this.completedResults);
  }

  /**
   * Get a formatted summary string for LLM context injection.
   */
  getFormattedSummary(): string | null {
    const summary = this.getSummary();
    if (!summary) return null;
    return formatSubAgentSummary(summary);
  }

  private normalizeRequest(request: SubAgentRequest): SubAgentRequest {
    // Fork mode: no prefix consistency validation needed (it's a clone, not a shared session)
    if (request.session_target === 'fork') return request;
    if (request.session_target !== 'shared') return request;

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
    };
  }

  /**
   * Async dispatch: fire-and-forget, publish events, return handle.
   */
  private executeAsync(
    request: SubAgentRequest,
    profile: SubAgentProfile,
    agentId: string,
  ): SubAgentHandle {
    const taskId = agentId;

    this.activeAgents.set(agentId, { profile, status: 'hiring' });
    this.controller.registerAgent(agentId, profile, 'hiring');

    this.deps.eventBus.publish({
      type: 'subagent.accepted',
      taskId,
      state: 'accepted',
    });

    // Fire-and-forget: executeCore runs in the background
    this.executeCore(request, profile, agentId)
      .then((result) => {
        const entry = this.activeAgents.get(agentId);
        if (entry) entry.result = result;
        this.controller.setResult(agentId, result);
        this.controller.updateStatus(agentId, 'terminated', result.summary);
        this.deps.eventBus.publish({
          type: result.success ? 'subagent.completed' : 'subagent.failed',
          taskId,
          state: result.success ? 'completed' : 'failed',
        });

        // Track for summary generation
        this.completedResults.push({ agentId, result });

        // Notify completion listener (for background auto-notify)
        this.deps.onSubAgentComplete?.(agentId, result);
      })
      .catch((error) => {
        const failResult = this.fail(profile.id, errorMessage(error), 'LOOP_CRASH');
        const entry = this.activeAgents.get(agentId);
        if (entry) entry.result = failResult;
        this.controller.setResult(agentId, failResult);
        this.controller.updateStatus(agentId, 'terminated', failResult.summary);
        this.deps.eventBus.publish({
          type: 'subagent.failed',
          taskId,
          state: 'failed',
        });
      })
      .finally(() => {
        const entry = this.activeAgents.get(agentId);
        if (!entry?.result) {
          this.activeAgents.delete(agentId);
        }
      });

    return { agentId, status: 'working', taskId };
  }

  /**
   * Synchronous dispatch: blocks until the sub-agent completes.
   */
  private async executeSync(
    request: SubAgentRequest,
    profile: SubAgentProfile,
    agentId: string,
  ): Promise<SubAgentResult> {
    return this.executeCore(request, profile, agentId);
  }

  /**
   * Core execution logic shared by async and sync paths.
   * Retries up to profile.maxAttempts on LOOP_FAILED (not LOOP_CRASH).
   */
  private async executeCore(
    request: SubAgentRequest,
    profile: SubAgentProfile,
    agentId: string,
  ): Promise<SubAgentResult> {
    const currentDepth = request.recursionDepth || 0;
    const MAX_RECURSION_DEPTH = 2;

    if (currentDepth >= MAX_RECURSION_DEPTH) {
      const msg = text.smallfry.errors.recursionLimitExceeded(currentDepth, MAX_RECURSION_DEPTH);
      getLogger().error(`[SubAgentManager] ${msg}`);
      return this.fail(profile.id, msg, 'LOOP_FAILED');
    }

    this.activeAgents.set(agentId, { profile, status: 'hiring' });
    this.controller.registerAgent(agentId, profile, 'hiring');

    getLogger().debug(
      `[SubAgentManager] ${text.smallfry.status.spawning} (ID: ${agentId}, Role: ${profile.role})`,
    );

    // Resolve LLM: per-profile model override or inherit parent
    const parentLlm = this.ctx.llm;
    if (!parentLlm) {
      const msg = text.smallfry.errors.dispatchMissingRuntimeLlm;
      getLogger().error(`[SubAgentManager] ${msg}`);
      return this.fail(profile.id, msg, 'LOOP_CRASH');
    }

    const llm = this.resolveLlm(profile, parentLlm);
    if (!llm) {
      const msg = `Failed to resolve LLM for model "${profile.model}"`;
      getLogger().error(`[SubAgentManager] ${msg}`);
      return this.fail(profile.id, msg, 'LOOP_CRASH');
    }

    const maxAttempts = profile.maxAttempts ?? 1;
    let lastResult: SubAgentResult | undefined;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
          request,
          llm,
          agentId,
          effectiveDryRun,
        );

        try {
          const workspace = runtimeEnv.workspace;
          if (!workspace) {
            throw new Error(
              'Runtime environment setup succeeded but workspace was not initialized',
            );
          }

          const activePath = workspace.workPath;

          const git = new GitAdapter(activePath);
          const resolver = new FileStateResolver(git, activePath);
          const flowMode = 'patch' as const;
          const fsAdapter = createFileSystemAdapter(flowMode);

          const initCtx = this.applyContextSnapshot(request.contextSnapshot, {
            workspace: {
              workPath: activePath,
              baseRepoPath: workspace.baseRepoPath,
              strategy: workspace.strategy,
            },
            options: {
              instruction: request.task,
              repoPath: activePath,
              dryRun: effectiveDryRun,
              contextFiles: request.contextFiles || [],
              llm,
              recursionDepth: currentDepth + 1,
              allowedToolNames: this.resolveAllowedTools(profile, request.teamId),
              timeoutMs: request.timeout_seconds
                ? request.timeout_seconds * 1000
                : profile.timeoutMs,
              subAgentSystemPrompt: profile.systemPrompt,
              agentId,
            },
            lastError,
            mode: flowMode,
            fs: fsAdapter,
            emit: (event) => {
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

          const subLoop = new SmallfryLoop(profile);
          const result = await subLoop.execute(initCtx);
          lastResult = result;

          // Success or non-retryable failure — return immediately
          if (result.success || result.reasonCode === 'LOOP_CRASH' || attempt >= maxAttempts) {
            return await this.persistArtifacts(agentId, {
              ...result,
              attempts: attempt,
            });
          }

          // Retryable failure — log and continue
          lastError = result.reason || result.summary;
          getLogger().warn(
            `[SubAgentManager] Smallfry ${agentId} attempt ${attempt}/${maxAttempts} failed (${result.reasonCode}), retrying...`,
          );
        } finally {
          await runtimeEnv.teardown();
        }
      } catch (error: unknown) {
        this.controller.appendLog(agentId, `Execution failed: ${errorMessage(error)}`);
        getLogger().error(`[SubAgentManager] Smallfry ${agentId} crashed: ${errorMessage(error)}`);
        // Crashes are not retryable
        return {
          agent_ref: profile.id,
          success: false,
          summary: text.smallfry.errors.missionFailedWithReason(errorMessage(error)),
          tokenUsage: 0,
          reason: errorMessage(error),
          reasonCode: 'LOOP_CRASH',
          attempts: attempt,
          logs: [],
          errorType: ErrorType.UNKNOWN,
        };
      }
    }

    // Should not reach here, but safety fallback
    return lastResult ?? this.fail(profile.id, text.smallfry.errors.missionFailed, 'LOOP_FAILED');
  }

  // Backward compatibility for internal calls (always synchronous)
  async spawn(request: SubAgentRequest): Promise<SubAgentResult> {
    const normalizedRequest = this.normalizeRequest(request);
    const profile = this.deps.registry.get(normalizedRequest.agent_ref);
    if (!profile) {
      return this.fail(
        normalizedRequest.agent_ref,
        text.smallfry.errors.profileNotFound(normalizedRequest.agent_ref),
        'LOOP_FAILED',
      );
    }
    const agentId = `smallfry-${randomBytes(4).toString('hex')}`;
    return this.executeSync(normalizedRequest, profile, agentId);
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

  private resolveAllowedTools(profile: SubAgentProfile, teamId?: string): string[] | undefined {
    const base = this.filterAllowedTools(
      profile.allowedTools,
      this.ctx.phase,
      profile.toolInheritance,
    );

    // Apply disallowedTools (denylist) — subtract from resolved tools
    let resolved = base;
    if (resolved !== undefined && profile.disallowedTools && profile.disallowedTools.length > 0) {
      const denied = new Set(profile.disallowedTools);
      resolved = resolved.filter((name) => !denied.has(name));
    }

    if (!teamId) return resolved;
    // When a teamId is present, add agent_team to the allowed tools
    if (resolved === undefined) return undefined; // Inherited all tools — agent_team already available
    return [...new Set([...resolved, 'agent_team'])];
  }

  /**
   * Resolve the LLM for a sub-agent based on profile.model.
   * 'inherit' or undefined → use parent LLM.
   * Other values → use llmFactory to create a model-specific LLM.
   */
  private resolveLlm(profile: SubAgentProfile, parentLlm: LLM): LLM | undefined {
    const model = profile.model;

    // Try llmFactory first for all models (including 'inherit').
    // This allows test harnesses to provide isolated LLMs for sub-agents.
    // In production, factories typically return undefined for 'inherit',
    // so the fallback to parentLlm is preserved.
    if (this.deps.llmFactory) {
      const modelLlm = this.deps.llmFactory(model ?? 'inherit');
      if (modelLlm) {
        getLogger().debug(
          `[SubAgentManager] Using llmFactory LLM for profile "${profile.id}" (model="${model ?? 'inherit'}")`,
        );
        return modelLlm;
      }
    }

    if (!model || model === 'inherit') {
      return parentLlm;
    }

    if (!this.deps.llmFactory) {
      getLogger().warn(
        `[SubAgentManager] Profile "${profile.id}" requests model "${model}" but no llmFactory configured. Falling back to parent LLM.`,
      );
      return parentLlm;
    }

    const modelLlm = this.deps.llmFactory(model);
    if (!modelLlm) {
      getLogger().warn(
        `[SubAgentManager] llmFactory returned no LLM for model "${model}". Falling back to parent LLM.`,
      );
      return parentLlm;
    }

    getLogger().debug(`[SubAgentManager] Using model "${model}" for profile "${profile.id}"`);
    return modelLlm;
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
          `[SubAgentManager] Failed to teardown isolated environment after setup error: ${errorMessage(teardownError)}`,
        );
      }
      throw error;
    }
  }

  private async persistArtifacts(agentId: string, result: SubAgentResult): Promise<SubAgentResult> {
    const patch = result.finalPatch;
    const { finalPatch: _ignored, ...rest } = result;
    const auditArtifact = await this.persistAuditArtifact(rest.auditPath);

    if (!patch || typeof patch !== 'string') {
      return {
        ...rest,
        auditPath: auditArtifact?.handle ?? rest.auditPath,
        auditArtifact: auditArtifact ?? rest.auditArtifact,
      };
    }

    const saved = await this.deps.artifactStore.saveText({
      content: patch,
      mimeType: 'text/x-diff',
      fileExt: 'patch',
    });

    return {
      ...rest,
      auditPath: auditArtifact?.handle ?? rest.auditPath,
      auditArtifact: auditArtifact,
      patchArtifact: saved,
    };
  }

  private filterAllowedTools(
    allowed: string[],
    phase: ToolRuntimeCtx['phase'],
    toolInheritance?: 'none' | 'safe' | 'all',
  ): string[] | undefined {
    const readOnlyPhase = isReadOnlySubAgentContext({
      flowMode: this.ctx.flowMode,
      phase,
    });

    // When toolInheritance is 'safe' or 'all' in non-read-only phase,
    // return undefined to skip allowlist filtering (inherits parent toolstack)
    if (!readOnlyPhase && toolInheritance && toolInheritance !== 'none') {
      return undefined;
    }

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
    } catch (error) {
      getLogger().debug(
        `[SubAgentManager] Failed to persist audit artifact: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}
