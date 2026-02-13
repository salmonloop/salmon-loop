import { text } from '../../locales/index.js';
import { recordAuditEvent } from '../audit-trail.js';
import { executeSalmonLoopFlow } from '../grizzco/flows/SalmonLoopFlow.js';
import type { FlowReport } from '../grizzco/pipeline.js';
import type { ShrinkCtx } from '../grizzco/types.js';
import { LIMITS } from '../limits.js';
import { sanitizeError } from '../llm/errors.js';
import type { HostBootContext } from '../orchestration/types.js';
import type { FileStateResolver } from '../strata/layers/file-state-resolver.js';
import type { WorkspaceSynchronizer } from '../strata/runtime/synchronizer.js';
import type { ArtifactHandle } from '../sub-agent/artifacts/types.js';
import type {
  Context,
  LoopEvent,
  LoopIteration,
  LoopOptions,
  FlowMode,
  AuthorizationSourceSummary,
  ExecutionPhase,
  LoopReasonCode,
} from '../types.js';

import { buildAuthorizationSummary } from './authorization-summary.js';
import { LoopTelemetry } from './loop-telemetry.js';

export class OperationCancelledError extends Error {
  constructor() {
    super('Operation cancelled by user');
    this.name = 'OperationCancelledError';
  }
}

export interface LoopExecutionCoordinatorParams {
  options: LoopOptions;
  flowMode: FlowMode;
  emit: (event: LoopEvent) => void;
  now: () => Date;
  fsAdapter: HostBootContext['fsAdapter'];
  env: HostBootContext['env'];
  synchronizer: WorkspaceSynchronizer;
  shadowTaskId: string;
  planRuntime?: HostBootContext['planRuntime'];
  fileStateResolver: FileStateResolver;
  telemetry: LoopTelemetry;
}

export interface LoopExecutionReport {
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

export class LoopExecutionCoordinator {
  private historyEntries: LoopIteration[] = [];
  private currentContext: Context | undefined;
  private currentLastError: string | undefined;
  private authorizationSummary: AuthorizationSourceSummary | null = null;
  private lastContext: ShrinkCtx | undefined;
  private lastVerifyArtifact: ArtifactHandle | undefined;

  constructor(private readonly params: LoopExecutionCoordinatorParams) {}

  public async execute(): Promise<LoopExecutionReport> {
    let retries = 0;
    let lastReport: FlowReport | undefined;
    let retryExhausted = false;

    while (retries <= LIMITS.maxRetries) {
      if (this.params.options.signal?.aborted) {
        throw new OperationCancelledError();
      }

      const attempt = retries + 1;
      recordAuditEvent(
        'loop.attempt.start',
        { attempt, flowMode: this.params.flowMode },
        { phase: 'PREFLIGHT', scope: 'session' },
      );
      const result = await executeSalmonLoopFlow({
        workspace: this.params.env.workspace!,
        options: this.params.options,
        mode: this.params.flowMode,
        fs: this.params.fsAdapter,
        emit: this.params.emit,
        fileStateResolver: this.params.fileStateResolver,
        planRuntime: this.params.planRuntime,
        shadowInitialRef: this.params.env.initialSnapshotHash!,
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
      const ctx = result.data as ShrinkCtx | undefined;
      if (ctx) {
        this.lastContext = ctx;
        if (ctx.verifyArtifact) {
          this.lastVerifyArtifact = ctx.verifyArtifact;
        }
      }
      const failureReason =
        sanitizeError(ctx?.lastError || result.error) || text.loop.loopExecutionFailed;

      const entry: LoopIteration = {
        attempt,
        plan: ctx?.plan ?? null,
        patch: ctx?.diff ?? null,
        error: failureReason,
        contextSummary: ctx?.context ? `Snippets: ${ctx.context.rgSnippets.length}` : 'No context',
      };
      this.historyEntries.push(entry);
      this.params.telemetry.addHistory(entry);

      this.authorizationSummary = buildAuthorizationSummary(
        ctx?.toolAuditLogger?.getLogs?.() as unknown[],
      );

      if (result.success) {
        const verifyOk = this.params.flowMode === 'review' ? true : ctx?.verifyResult?.ok !== false;
        const applyBackFailed =
          this.params.flowMode !== 'review' &&
          ctx?.applyBackResult?.success === false &&
          !ctx.applyBackResult.skipped;

        if (verifyOk && applyBackFailed) {
          const applyBackMessage =
            ctx.applyBackResult?.error || 'Failed to apply changes back to main workspace';
          recordAuditEvent(
            'loop.attempt.failure',
            { attempt, flowMode: this.params.flowMode, reason: applyBackMessage },
            { phase: 'APPLY_BACK', severity: 'high', scope: 'session' },
          );
          return {
            success: false,
            attempts: attempt,
            flowReport: result,
            history: [...this.historyEntries],
            authorizationSummary: this.authorizationSummary,
            lastErrorCode: this.extractErrorCode(result.error),
            retryExhausted: false,
            lastContext: ctx,
            lastVerifyArtifact: this.lastVerifyArtifact,
            terminalReason: applyBackMessage,
            terminalReasonCode: 'APPLY_BACK_FAILED',
            terminalFailurePhase: 'APPLY_BACK',
          };
        }

        if (verifyOk) {
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
            lastContext: ctx,
            lastVerifyArtifact: this.lastVerifyArtifact,
          };
        }
      }

      recordAuditEvent(
        'loop.attempt.failure',
        { attempt, flowMode: this.params.flowMode, reason: failureReason },
        { phase: 'VERIFY', severity: 'medium', scope: 'session' },
      );
      this.currentContext = ctx?.context;
      if (failureReason) {
        this.currentLastError = failureReason;
      }

      retries++;

      if (retries <= LIMITS.maxRetries) {
        this.params.emit({
          type: 'retry',
          fromAttempt: attempt,
          toAttempt: attempt + 1,
          reason: failureReason,
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
