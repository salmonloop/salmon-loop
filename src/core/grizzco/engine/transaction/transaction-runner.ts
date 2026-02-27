import { recordAuditEvent } from '../../../observability/audit-trail.js';
import { ReflectionEngine } from '../../../reflection/engine.js';
import type { ReflectionInput } from '../../../reflection/types.js';
import type { FileStateResolver } from '../../../strata/layers/file-state-resolver.js';
import type { WorkspaceSynchronizer } from '../../../strata/runtime/synchronizer.js';
import type { ArtifactHandle } from '../../../sub-agent/artifacts/types.js';
import type {
  AuthorizationSourceSummary,
  CheckpointRef,
  Context,
  ExecutionWorkspace,
  FileSystem,
  FlowMode,
  LoopEvent,
  LoopIteration,
  LoopOptions,
} from '../../../types/index.js';
import { executeSalmonLoopFlow } from '../../flows/SalmonLoopFlow.js';
import type { FlowTerminalCtx } from '../../flows/SalmonLoopFlow.js';
import { LoopTelemetry } from '../observability/loop-telemetry.js';
import type { FlowReport } from '../pipeline/pipeline.js';
import type { InitCtx, ShrinkCtx } from '../pipeline/types.js';

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
  private lastContext: ShrinkCtx | undefined;
  private lastVerifyArtifact: ArtifactHandle | undefined;

  constructor(private readonly params: FlowTransactionRunnerParams) {}

  private isShrinkCtx(ctx: FlowTerminalCtx | undefined): ctx is ShrinkCtx {
    return Boolean(ctx && 'verifyResult' in ctx);
  }

  public async execute(): Promise<FlowTransactionReport> {
    let retries = 0;
    let lastReport: FlowReport | undefined;

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
      const shrinkCtx = this.isShrinkCtx(terminalCtx) ? terminalCtx : undefined;
      if (shrinkCtx) {
        this.lastContext = shrinkCtx;
        if (shrinkCtx.verifyArtifact) {
          this.lastVerifyArtifact = shrinkCtx.verifyArtifact;
        }
      }

      const attemptFailure = resolveAttemptFailure({
        flowReport: result,
        context: shrinkCtx,
        flowMode: this.params.flowMode,
      });

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
        const successPhase = this.params.flowMode === 'review' ? 'SHRINK' : 'APPLY_BACK';
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

      recordAuditEvent(
        'loop.attempt.failure',
        {
          attempt,
          flowMode: this.params.flowMode,
          reason: attemptFailure.reason,
          reasonCode: attemptFailure.reasonCode,
          failurePhase: attemptFailure.failurePhase,
          retryable: attemptFailure.retryable,
          errorCode: attemptFailure.errorCode,
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
