import type { ToolCallingAuditEntry } from '../../../llm/audit.js';
import { recordAuditEvent } from '../../../observability/audit-trail.js';
import { mapErrorForAudit } from '../../../observability/error-mapping.js';
import { ReflectionEngine } from '../../../reflection/engine.js';
import type { ReflectionInput } from '../../../reflection/types.js';
import type { FileStateResolver } from '../../../strata/layers/file-state-resolver.js';
import type { WorkspaceSynchronizer } from '../../../strata/runtime/synchronizer.js';
import type { ArtifactHandle } from '../../../sub-agent/artifacts/types.js';
import type { Context } from '../../../types/context.js';
import type { CheckpointRef, ExecutionWorkspace } from '../../../types/loop.js';
import type {
  AuthorizationSourceSummary,
  FileSystem,
  FlowMode,
  LoopEvent,
  LoopIteration,
  LoopOptions,
} from '../../../types/runtime.js';
import { executeSalmonLoopFlow } from '../../flows/SalmonLoopFlow.js';
import { LoopTelemetry } from '../observability/loop-telemetry.js';
import type { FlowReport } from '../pipeline/pipeline.js';
import type { InitCtx, ShrinkCtx, TerminalCtx } from '../pipeline/types.js';

import { resolveAttemptFailure } from './attempt-failure.js';
import { buildAuthorizationSummary } from './authorization-summary.js';
import {
  mapRetryExhaustedReport,
  mapSuccessReport,
  mapTerminalFailureReport,
} from './report-mapper.js';
import { evaluateRetryPolicy } from './retry-policy.js';
import type { FlowTransactionReport } from './types.js';

export class FlowTransactionCancelledError extends Error {
  constructor() {
    super('Operation cancelled by user');
    this.name = 'FlowTransactionCancelledError';
  }
}

function isArtifactHandle(value: unknown): value is ArtifactHandle {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { handle?: unknown }).handle === 'string'
  );
}

function mergeArtifactHandles(
  existing: ArtifactHandle[],
  incoming: ArtifactHandle[],
  limit = 4,
): ArtifactHandle[] {
  const merged = [...existing];
  const seen = new Set(existing.map((artifact) => artifact.handle));

  for (const artifact of incoming) {
    if (seen.has(artifact.handle)) continue;
    merged.push(artifact);
    seen.add(artifact.handle);
  }

  if (merged.length <= limit) return merged;
  return merged.slice(merged.length - limit);
}

function extractSubAgentArtifacts(entries: ToolCallingAuditEntry[] | undefined): {
  patchArtifacts: ArtifactHandle[];
  auditArtifacts: ArtifactHandle[];
} {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { patchArtifacts: [], auditArtifacts: [] };
  }

  const patchArtifacts: ArtifactHandle[] = [];
  const auditArtifacts: ArtifactHandle[] = [];

  for (const entry of entries) {
    if (entry?.toolName !== 'agent_dispatch' || entry.toolResultStatus !== 'ok') continue;
    if (isArtifactHandle(entry.toolResultPatchArtifact)) {
      patchArtifacts.push(entry.toolResultPatchArtifact);
    }
    if (isArtifactHandle(entry.toolResultAuditArtifact)) {
      auditArtifacts.push(entry.toolResultAuditArtifact);
    }
  }

  return { patchArtifacts, auditArtifacts };
}

function extractRecentReadArtifacts(entries: ToolCallingAuditEntry[] | undefined): Array<{
  path: string;
  artifact: ArtifactHandle;
}> {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const recentReads: Array<{ path: string; artifact: ArtifactHandle }> = [];

  for (const entry of entries) {
    if (entry.toolIntent !== 'READ' || entry.toolResultStatus !== 'ok') continue;
    if (typeof entry.toolResultReadArtifactPath !== 'string') continue;
    if (!isArtifactHandle(entry.toolResultReadArtifact)) continue;
    recentReads.push({
      path: entry.toolResultReadArtifactPath,
      artifact: entry.toolResultReadArtifact,
    });
  }

  return recentReads;
}

function mergeReadArtifacts(
  existing: Array<{ path: string; artifact: ArtifactHandle }>,
  incoming: Array<{ path: string; artifact: ArtifactHandle }>,
  limit = 6,
): Array<{ path: string; artifact: ArtifactHandle }> {
  const merged: Array<{ path: string; artifact: ArtifactHandle }> = [];
  const seen = new Set<string>();

  for (const item of [...existing, ...incoming]) {
    const key = `${item.path}::${item.artifact.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  if (merged.length <= limit) return merged;
  return merged.slice(merged.length - limit);
}

interface FlowTransactionEnvironment {
  workspace: ExecutionWorkspace;
  shadowInitialRef: string;
  initialSnapshotHash?: string;
  checkpointRef?: CheckpointRef;
  activeRepoPath: string;
}

export interface FlowTransactionRunnerParams {
  options: LoopOptions;
  flowMode: FlowMode;
  emit: (event: LoopEvent) => void;
  now: () => Date;
  fsAdapter: FileSystem;
  env: FlowTransactionEnvironment;
  synchronizer: WorkspaceSynchronizer;
  shadowTaskId: string;
  planRuntime?: InitCtx['planRuntime'];
  fileStateResolver: FileStateResolver;
  telemetry: LoopTelemetry;
}

export class FlowTransactionRunner {
  private historyEntries: LoopIteration[] = [];
  private currentContext: Context | undefined;
  private currentLastError: string | undefined;
  private authorizationSummary: AuthorizationSourceSummary | null = null;
  private lastContext: TerminalCtx | undefined;
  private lastVerifyArtifact: ArtifactHandle | undefined;
  private lastSubAgentPatchArtifacts: ArtifactHandle[] = [];
  private lastSubAgentAuditArtifacts: ArtifactHandle[] = [];
  private lastRecentReadArtifacts: Array<{ path: string; artifact: ArtifactHandle }> = [];

  constructor(private readonly params: FlowTransactionRunnerParams) {}

  private isShrinkCtx(ctx: TerminalCtx | undefined): ctx is ShrinkCtx {
    return Boolean(ctx && 'verifyResult' in ctx);
  }

  public async execute(): Promise<FlowTransactionReport> {
    let retries = 0;
    let lastReport: FlowReport | undefined;
    let lastAttemptFailure: ReturnType<typeof resolveAttemptFailure> | undefined;

    while (true) {
      if (this.params.options.signal?.aborted) {
        throw new FlowTransactionCancelledError();
      }

      const attempt = retries + 1;
      recordAuditEvent(
        'loop.attempt.start',
        { attempt, flowMode: this.params.flowMode },
        { phase: 'PREFLIGHT', scope: 'session' },
      );
      const result = await executeSalmonLoopFlow({
        workspace: this.params.env.workspace,
        options: this.params.options,
        mode: this.params.flowMode,
        fs: this.params.fsAdapter,
        emit: this.params.emit,
        fileStateResolver: this.params.fileStateResolver,
        planRuntime: this.params.planRuntime,
        shadowInitialRef: this.params.env.shadowInitialRef,
        attempt,
        initialContext: this.currentContext,
        artifactHints: {
          verifyArtifact: this.lastVerifyArtifact,
          subAgentPatchArtifacts:
            this.lastSubAgentPatchArtifacts.length > 0
              ? this.lastSubAgentPatchArtifacts
              : undefined,
          subAgentAuditArtifacts:
            this.lastSubAgentAuditArtifacts.length > 0
              ? this.lastSubAgentAuditArtifacts
              : undefined,
          recentReadArtifacts:
            this.lastRecentReadArtifacts.length > 0 ? this.lastRecentReadArtifacts : undefined,
        },
        lastError: this.currentLastError,
        applyBackRuntime: {
          activeRepoPath: this.params.env.activeRepoPath,
          shadowTaskId: this.params.shadowTaskId,
          checkpointRef: this.params.env.checkpointRef,
          initialSnapshotHash: this.params.env.initialSnapshotHash,
          synchronizer: this.params.synchronizer,
        },
      });

      lastReport = result;
      const terminalCtx = result.data;
      if (terminalCtx) {
        this.lastContext = terminalCtx;
      }
      const shrinkCtx = this.isShrinkCtx(terminalCtx) ? terminalCtx : undefined;
      if (shrinkCtx?.verifyArtifact) {
        this.lastVerifyArtifact = shrinkCtx.verifyArtifact;
      }
      const subAgentArtifacts = extractSubAgentArtifacts(terminalCtx?.toolCallingAudit);
      this.lastSubAgentPatchArtifacts = mergeArtifactHandles(
        this.lastSubAgentPatchArtifacts,
        subAgentArtifacts.patchArtifacts,
      );
      this.lastSubAgentAuditArtifacts = mergeArtifactHandles(
        this.lastSubAgentAuditArtifacts,
        subAgentArtifacts.auditArtifacts,
      );
      this.lastRecentReadArtifacts = mergeReadArtifacts(
        this.lastRecentReadArtifacts,
        extractRecentReadArtifacts(terminalCtx?.toolCallingAudit),
      );

      const attemptFailure = resolveAttemptFailure({
        flowReport: result,
        context: shrinkCtx,
        flowMode: this.params.flowMode,
      });
      lastAttemptFailure = attemptFailure;

      const entry: LoopIteration = {
        attempt,
        plan: shrinkCtx?.plan ?? null,
        patch: shrinkCtx?.diff ?? null,
        error: attemptFailure?.reason,
        contextSummary: shrinkCtx?.context
          ? `Snippets: ${shrinkCtx.context.rgSnippets.length}`
          : 'No context',
      };
      this.historyEntries.push(entry);
      this.params.telemetry.addHistory(entry);

      this.authorizationSummary = buildAuthorizationSummary(
        shrinkCtx?.toolAuditLogger?.getLogs?.() as unknown[],
      );

      if (!attemptFailure) {
        const successPhase =
          this.params.flowMode === 'review' || this.params.flowMode === 'research'
            ? 'SHRINK'
            : 'APPLY_BACK';
        recordAuditEvent(
          'loop.attempt.success',
          { attempt, flowMode: this.params.flowMode },
          { phase: successPhase, severity: 'low', scope: 'session' },
        );

        // Reflection Mechanism: trigger when multiple attempts were needed
        if (attempt > 1 && this.params.options.llm) {
          const reflectionEngine = new ReflectionEngine(this.params.options.llm);
          const reflectionInput: ReflectionInput = {
            instruction: this.params.options.instruction,
            history: this.historyEntries,
            success: true,
            metadata: shrinkCtx?.context?.projectMetadata,
            finalPlan: shrinkCtx?.plan,
            finalPatch: shrinkCtx?.diff,
          };
          reflectionEngine
            .reflect(reflectionInput, this.params.options.repoPath)
            .catch((e: unknown) =>
              recordAuditEvent('reflection.error', { error: String(e) }, { severity: 'medium' }),
            );
        }

        return mapSuccessReport({
          attempt,
          flowReport: result,
          history: this.historyEntries,
          authorizationSummary: this.authorizationSummary,
          lastErrorCode: this.extractErrorCode(result.error),
          lastContext: shrinkCtx,
          lastVerifyArtifact: this.lastVerifyArtifact,
        });
      }

      if (attemptFailure.reasonCode === 'AWAITING_INPUT') {
        const inputRequired = attemptFailure.inputRequired;
        this.params.emit({
          type: 'task.awaiting_input',
          reason: inputRequired?.reason ?? 'clarification',
          prompt: inputRequired?.prompt ?? attemptFailure.reason,
          inputRequired,
          timestamp: this.params.now(),
        });
      }

      const mappedAuditError = mapErrorForAudit({
        message: attemptFailure.safeHint ?? attemptFailure.reason,
        code: attemptFailure.errorCode ?? attemptFailure.reasonCode,
      });

      recordAuditEvent(
        'loop.attempt.failure',
        {
          attempt,
          flowMode: this.params.flowMode,
          reason: attemptFailure.reason,
          reasonCode: attemptFailure.reasonCode,
          diagnosticCode: attemptFailure.diagnosticCode,
          safeHint: attemptFailure.safeHint,
          remediationSteps: attemptFailure.remediationSteps,
          failurePhase: attemptFailure.failurePhase,
          retryable: attemptFailure.retryable,
          errorCode: attemptFailure.errorCode,
          errorSummary: mappedAuditError.summary,
          errorCategory: mappedAuditError.category,
          errorRedacted: mappedAuditError.redacted,
          lastStep: result.lastStep,
        },
        {
          phase: attemptFailure.failurePhase,
          severity: attemptFailure.failurePhase === 'APPLY_BACK' ? 'high' : 'medium',
          scope: 'session',
        },
      );

      const retryDecision = evaluateRetryPolicy({
        retries,
        failure: attemptFailure,
      });
      retries = retryDecision.retries;

      if (!retryDecision.shouldRetry) {
        if (retryDecision.retryExhausted) {
          break;
        }

        return mapTerminalFailureReport({
          attempt,
          flowReport: result,
          history: this.historyEntries,
          authorizationSummary: this.authorizationSummary,
          lastErrorCode: attemptFailure.errorCode ?? this.extractErrorCode(result.error),
          lastContext: shrinkCtx,
          lastVerifyArtifact: this.lastVerifyArtifact,
          failure: attemptFailure,
        });
      }

      this.currentContext = shrinkCtx?.context;
      this.currentLastError = attemptFailure.reason;
      this.params.emit({
        type: 'retry',
        fromAttempt: attempt,
        toAttempt: attempt + 1,
        reason: attemptFailure.reason,
        failedFiles: [],
        timestamp: this.params.now(),
      });
    }

    if (!lastReport) {
      throw new Error('SalmonLoop execution terminated without a FlowReport');
    }

    return mapRetryExhaustedReport({
      attempts: retries,
      flowReport: lastReport,
      history: this.historyEntries,
      authorizationSummary: this.authorizationSummary,
      failure: lastAttemptFailure,
      lastErrorCode: this.extractErrorCode(lastReport.error),
      lastContext: this.lastContext,
      lastVerifyArtifact: this.lastVerifyArtifact,
    });
  }

  private extractErrorCode(error: unknown): string | undefined {
    if (typeof error === 'object' && error !== null) {
      return (
        (error as { llmCode?: string; code?: string; name?: string }).llmCode ??
        (error as { llmCode?: string; code?: string; name?: string }).code ??
        (error as { llmCode?: string; code?: string; name?: string }).name
      );
    }
    return undefined;
  }
}
