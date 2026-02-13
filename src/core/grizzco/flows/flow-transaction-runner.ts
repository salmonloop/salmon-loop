import { recordAuditEvent } from '../../audit-trail.js';
import { LIMITS } from '../../limits.js';
import type { FileStateResolver } from '../../strata/layers/file-state-resolver.js';
import type { WorkspaceSynchronizer } from '../../strata/runtime/synchronizer.js';
import type { ArtifactHandle } from '../../sub-agent/artifacts/types.js';
import type {
  AuthorizationSourceSummary,
  CheckpointRef,
  Context,
  ExecutionPhase,
  ExecutionWorkspace,
  FileSystem,
  FlowMode,
  LoopEvent,
  LoopIteration,
  LoopOptions,
  LoopReasonCode,
} from '../../types.js';
import type { FlowReport } from '../pipeline.js';
import type { InitCtx, ShrinkCtx } from '../types.js';

import { resolveAttemptFailure } from './flow-attempt-failure.js';
import { buildAuthorizationSummary } from './flow-authorization-summary.js';
import { LoopTelemetry } from './flow-telemetry.js';
import { executeSalmonLoopFlow } from './SalmonLoopFlow.js';
import type { FlowTerminalCtx } from './SalmonLoopFlow.js';

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

export interface FlowTransactionReport {
  success: boolean;
  attempts: number;
  flowReport: FlowReport;
  history: LoopIteration[];
  authorizationSummary?: AuthorizationSourceSummary | null;
  lastErrorCode?: string;
  retryExhausted: boolean;
  lastContext?: ShrinkCtx | undefined;
  lastVerifyArtifact?: ArtifactHandle;
  terminalReason?: string;
  terminalReasonCode?: LoopReasonCode;
  terminalFailurePhase?: ExecutionPhase;
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
    let retryExhausted = false;

    while (retries <= LIMITS.maxRetries) {
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

      const verifyOk =
        this.params.flowMode === 'review' ? true : shrinkCtx?.verifyResult?.ok !== false;
      const applyBackFailed =
        this.params.flowMode !== 'review' &&
        shrinkCtx?.applyBackResult?.success === false &&
        !shrinkCtx.applyBackResult.skipped;
      const attemptFailure =
        verifyOk && applyBackFailed
          ? {
              reason:
                shrinkCtx.applyBackResult?.error ||
                'Failed to apply changes back to main workspace',
              reasonCode: 'APPLY_BACK_FAILED' as const,
              failurePhase: 'APPLY_BACK' as const,
              retryable: false,
              errorCode: 'APPLY_BACK_FAILED',
            }
          : result.success && verifyOk
            ? undefined
            : resolveAttemptFailure({
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
        return {
          success: true,
          attempts: attempt,
          flowReport: result,
          history: [...this.historyEntries],
          authorizationSummary: this.authorizationSummary,
          lastErrorCode: this.extractErrorCode(result.error),
          retryExhausted: false,
          lastContext: shrinkCtx,
          lastVerifyArtifact: this.lastVerifyArtifact,
        };
      }

      recordAuditEvent(
        'loop.attempt.failure',
        { attempt, flowMode: this.params.flowMode, reason: attemptFailure.reason },
        {
          phase: attemptFailure.failurePhase,
          severity: attemptFailure.failurePhase === 'APPLY_BACK' ? 'high' : 'medium',
          scope: 'session',
        },
      );

      if (!attemptFailure.retryable) {
        return {
          success: false,
          attempts: attempt,
          flowReport: result,
          history: [...this.historyEntries],
          authorizationSummary: this.authorizationSummary,
          lastErrorCode: attemptFailure.errorCode ?? this.extractErrorCode(result.error),
          retryExhausted: false,
          lastContext: shrinkCtx,
          lastVerifyArtifact: this.lastVerifyArtifact,
          terminalReason: attemptFailure.reason,
          terminalReasonCode: attemptFailure.reasonCode,
          terminalFailurePhase: attemptFailure.failurePhase,
        };
      }

      this.currentContext = shrinkCtx?.context;
      this.currentLastError = attemptFailure.reason;

      retries++;

      if (retries <= LIMITS.maxRetries) {
        this.params.emit({
          type: 'retry',
          fromAttempt: attempt,
          toAttempt: attempt + 1,
          reason: attemptFailure.reason,
          failedFiles: [],
          timestamp: this.params.now(),
        });
      }

      if (retries > LIMITS.maxRetries) {
        retryExhausted = true;
        break;
      }
    }

    if (!lastReport) {
      throw new Error('SalmonLoop execution terminated without a FlowReport');
    }

    return {
      success: false,
      attempts: retries,
      flowReport: lastReport,
      history: [...this.historyEntries],
      authorizationSummary: this.authorizationSummary,
      lastErrorCode: this.extractErrorCode(lastReport.error),
      retryExhausted,
      lastContext: this.lastContext,
      lastVerifyArtifact: this.lastVerifyArtifact,
    };
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
