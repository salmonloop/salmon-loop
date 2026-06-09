import { recordAuditEvent, setAuditContext } from '../../../observability/audit-trail.js';
import { getLogger } from '../../../observability/logger.js';
import { appendPlanNote } from '../../../plan/index.js';
import {
  EXECUTION_PHASES,
  type ExecutionPhase,
  type LoopEvent,
  type FlowMode,
} from '../../../types/runtime.js';
import { isRecord } from '../../../utils/serialize.js';

/**
 * Pipeline Step Definition
 * In: Input Context type
 * Out: Output Context type
 */
export type Step<In, Out> = (ctx: In) => Promise<Out>;

export interface Span {
  name: string;
  start: number;
  end: number;
  duration: number;
  error?: string;
  metadata?: unknown;
}

/**
 * Execution Report
 */
export interface FlowReport<T = unknown> {
  success: boolean;
  error?: Error;
  lastStep?: string;
  duration: number;
  data?: T;
  traces: Span[];
  strategyName?: string;
  fsMode?: FlowMode;
  auditPath?: string;
}

/**
 * Typed Async Pipeline Container
 */
export class Pipeline<CurrentCtx> {
  private constructor(
    private readonly promise: Promise<CurrentCtx>,
    private readonly startTime: number = Date.now(),
    private readonly lastStepName: string = 'INIT',
    private readonly traces: Span[] = [],
    private readonly ctxRef: { current?: unknown } = {},
  ) {}

  /**
   * Initialize a new pipeline
   */
  static of<T>(ctx: T): Pipeline<T> {
    return new Pipeline(Promise.resolve(ctx), Date.now(), 'INIT', [], { current: ctx });
  }

  /**
   * Add a step to the pipeline
   */
  step<NextCtx>(name: string, action: Step<CurrentCtx, NextCtx>): Pipeline<NextCtx> {
    const nextPromise = this.executeStep(name, action, async () => {
      // No recovery for plain steps — check for APPLY_BACK structured failure
      const result = this.ctxRef.current;
      if (name === 'APPLY_BACK' && isRecord(result) && isRecord(result.applyBackResult)) {
        const applyBackResult = result.applyBackResult as {
          success?: boolean;
          skipped?: boolean;
          safeMessage?: string;
          error?: string;
          errorCode?: string;
        };
        if (applyBackResult.success === false && !applyBackResult.skipped) {
          return {
            errorStr: applyBackResult.safeMessage || applyBackResult.error || 'Apply-back failed',
            errorMeta: {
              name: 'ApplyBackFailure',
              code: applyBackResult.errorCode || 'APPLY_BACK_FAILED',
            },
          };
        }
      }
      return null;
    });
    return new Pipeline(nextPromise, this.startTime, name, this.traces, this.ctxRef);
  }

  /**
   * Add a step with error recovery
   */
  stepWithRecovery<NextCtx>(
    name: string,
    action: Step<CurrentCtx, NextCtx>,
    recovery: Step<CurrentCtx, unknown>,
  ): Pipeline<NextCtx> {
    const nextPromise = this.executeStep(name, action, async (ctx, errorStr) => {
      const recStart = Date.now();
      try {
        await recovery(ctx);
        this.traces.push({
          name: `${name}:recovery`,
          start: recStart,
          end: Date.now(),
          duration: Date.now() - recStart,
          metadata: { success: true },
        });
      } catch (recError) {
        const recEnd = Date.now();
        const errorDetail = recError instanceof Error ? recError.message : String(recError);
        this.traces.push({
          name: `${name}:recovery`,
          start: recStart,
          end: recEnd,
          duration: recEnd - recStart,
          error: errorDetail,
          metadata: { success: false, phase: 'RECOVERY_FAILURE' },
        });
        getLogger().audit(
          'PIPELINE_RECOVERY_FAILED',
          { step: name, originalError: errorStr, recoveryError: errorDetail },
          { source: 'system', severity: 'high', scope: 'session' },
        );
      }
      return null; // Always re-throw original error
    });
    return new Pipeline(nextPromise, this.startTime, name, this.traces, this.ctxRef);
  }

  /**
   * Core step execution shared by step() and stepWithRecovery().
   * Handles: abort check, phase events, plan journaling, tracing.
   * The onError callback runs recovery/post-processing; return non-null to inject error metadata.
   */
  private async executeStep<NextCtx>(
    name: string,
    action: Step<CurrentCtx, NextCtx>,
    onError: (
      ctx: CurrentCtx,
      errorStr: string,
    ) => Promise<{ errorStr: string; errorMeta?: Record<string, unknown> } | null>,
  ): Promise<NextCtx> {
    const start = Date.now();
    let phaseStarted = false;
    let errorStr: string | undefined;
    let errorMeta: Record<string, unknown> | undefined;
    let result: NextCtx | undefined;

    const ctx = await this.promise;
    const emit = (ctx as { emit?: (event: LoopEvent) => void }).emit;
    const isPhase = (value: string): value is ExecutionPhase =>
      (EXECUTION_PHASES as readonly string[]).includes(value);
    const ctxObj = isRecord(ctx) ? ctx : null;
    const planRuntime = ctxObj?.planRuntime as
      | { sessionId: string; planPathHint: string }
      | undefined;
    const workspace = isRecord(ctxObj?.workspace) ? ctxObj.workspace : null;
    const persistenceRoot =
      (typeof workspace?.baseRepoPath === 'string' ? workspace.baseRepoPath : undefined) ||
      (typeof workspace?.workPath === 'string' ? workspace.workPath : undefined);
    const attempt = typeof ctxObj?.attempt === 'number' ? ctxObj.attempt : 1;

    const tryAppendPlanNote = async (note: string) => {
      if (!planRuntime || !persistenceRoot) return;
      try {
        await appendPlanNote({ persistenceRoot, sessionId: planRuntime.sessionId, note });
        recordAuditEvent(
          'plan.runtime.note.append',
          { note, ok: true },
          { source: 'plan', severity: 'low', scope: 'session', phase: name },
        );
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        recordAuditEvent(
          'plan.runtime.note.append.failed',
          { note, error: msg },
          { source: 'plan', severity: 'low', scope: 'session', phase: name },
        );
        getLogger().debug(`[PlanRuntime] Failed to append note: ${msg}`);
        return false;
      }
    };

    try {
      this.ctxRef.current = ctx;
      const options = isRecord(ctxObj?.options) ? ctxObj.options : null;
      const signal = options?.signal as AbortSignal | undefined;
      const strategy = (workspace?.strategy ?? options?.strategy) as string | undefined;
      if (signal?.aborted && strategy === 'worktree') {
        throw new Error('Operation cancelled by user');
      }
      setAuditContext({ phase: name });
      if (emit && isPhase(name)) {
        emit({ type: 'phase.start', phase: name, timestamp: new Date() });
        phaseStarted = true;
        const ok = await tryAppendPlanNote(`Attempt ${attempt}: phase.start ${name}`);
        if (planRuntime && ok !== undefined) {
          emit({
            type: 'plan.runtime.journal',
            sessionId: planRuntime.sessionId,
            phase: name,
            kind: 'start',
            attempt,
            ok,
            timestamp: new Date(),
          });
        }
      }
      result = await action(ctx);
      this.ctxRef.current = result;

      // Check for structured failures (e.g., APPLY_BACK)
      const postResult = await onError(ctx, '');
      if (postResult) {
        errorStr = postResult.errorStr;
        errorMeta = postResult.errorMeta;
      }

      return result;
    } catch (error) {
      errorStr = error instanceof Error ? error.message : String(error);
      errorMeta =
        typeof error === 'object' && error !== null
          ? {
              name: (error as { name?: string }).name,
              code: (error as { code?: string }).code,
              llmCode: (error as { llmCode?: string }).llmCode,
            }
          : undefined;

      // Run recovery/post-processing
      const postResult = await onError(ctx, errorStr);
      if (postResult?.errorStr) {
        errorStr = postResult.errorStr;
        errorMeta = postResult.errorMeta;
      }

      throw error;
    } finally {
      if (emit && isPhase(name) && phaseStarted) {
        emit({ type: 'phase.end', phase: name, success: !errorStr, timestamp: new Date() });
        const ok = await tryAppendPlanNote(
          `Attempt ${attempt}: phase.end ${name} (success=${String(!errorStr)})`,
        );
        if (planRuntime && ok !== undefined) {
          emit({
            type: 'plan.runtime.journal',
            sessionId: planRuntime.sessionId,
            phase: name,
            kind: 'end',
            attempt,
            ok,
            timestamp: new Date(),
          });
        }
      }
      setAuditContext({ phase: undefined });
      const end = Date.now();
      this.traces.push({
        name,
        start,
        end,
        duration: end - start,
        error: errorStr,
        metadata: errorMeta,
      });
    }
  }

  /**
   * Execute the pipeline and get the final result
   */
  async execute(): Promise<FlowReport<CurrentCtx>> {
    try {
      const data = await this.promise;
      const lastExecutedStep =
        [...this.traces].reverse().find((trace) => !trace.name.endsWith(':recovery'))?.name ??
        this.lastStepName;
      return {
        success: true,
        duration: Date.now() - this.startTime,
        lastStep: lastExecutedStep,
        data,
        traces: this.traces,
      };
    } catch (error) {
      const lastExecutedStep =
        [...this.traces].reverse().find((trace) => !trace.name.endsWith(':recovery'))?.name ??
        this.lastStepName;
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        lastStep: lastExecutedStep,
        duration: Date.now() - this.startTime,
        data: this.ctxRef.current as CurrentCtx | undefined,
        traces: this.traces,
      };
    }
  }

  /**
   * Get the promise for direct access (advanced use)
   */
  async getPromise(): Promise<CurrentCtx> {
    return this.promise;
  }

  /**
   * Cast the pipeline to a new context type (advanced usage).
   */
  cast<NewCtx>(): Pipeline<NewCtx> {
    return this as unknown as Pipeline<NewCtx>;
  }
}
