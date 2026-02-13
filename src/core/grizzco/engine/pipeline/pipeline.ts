import { recordAuditEvent, setAuditContext } from '../../../observability/audit-trail.js';
import { logger } from '../../../observability/logger.js';
import { appendPlanNote } from '../../../plan/index.js';
import {
  EXECUTION_PHASES,
  type ExecutionPhase,
  type LoopEvent,
  type FlowMode,
} from '../../../types.js';

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
    const nextPromise = this.promise.then(async (ctx) => {
      const start = Date.now();
      let phaseStarted = false;
      let errorStr: string | undefined;
      let errorMeta: Record<string, unknown> | undefined;
      let result;
      const emit = (ctx as { emit?: (event: LoopEvent) => void }).emit;
      const isPhase = (value: string): value is ExecutionPhase =>
        (EXECUTION_PHASES as readonly string[]).includes(value);
      const planRuntime = (ctx as any)?.planRuntime as
        | { sessionId: string; planPathHint: string }
        | undefined;
      const persistenceRoot =
        (ctx as any)?.workspace?.baseRepoPath || (ctx as any)?.workspace?.workPath;
      const attempt = (ctx as any)?.attempt ?? 1;

      const tryAppendPlanNote = async (note: string) => {
        if (!planRuntime || !persistenceRoot) return;
        try {
          await appendPlanNote({
            persistenceRoot,
            sessionId: planRuntime.sessionId,
            note,
          });
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
          logger.debug(`[PlanRuntime] Failed to append note: ${msg}`);
          return false;
        }
      };

      try {
        this.ctxRef.current = ctx;
        const signal = (ctx as any)?.options?.signal as AbortSignal | undefined;
        const strategy = (ctx as any)?.workspace?.strategy ?? (ctx as any)?.options?.strategy;
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
        throw error;
      } finally {
        if (emit && isPhase(name) && phaseStarted) {
          emit({
            type: 'phase.end',
            phase: name,
            success: !errorStr,
            timestamp: new Date(),
          });
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
    const nextPromise = this.promise.then(async (ctx) => {
      const start = Date.now();
      let phaseStarted = false;
      let abortedBeforeAction = false;
      let errorStr: string | undefined;
      let errorMeta: Record<string, unknown> | undefined;
      let result;
      const emit = (ctx as { emit?: (event: LoopEvent) => void }).emit;
      const isPhase = (value: string): value is ExecutionPhase =>
        (EXECUTION_PHASES as readonly string[]).includes(value);
      const planRuntime = (ctx as any)?.planRuntime as
        | { sessionId: string; planPathHint: string }
        | undefined;
      const persistenceRoot =
        (ctx as any)?.workspace?.baseRepoPath || (ctx as any)?.workspace?.workPath;
      const attempt = (ctx as any)?.attempt ?? 1;

      const tryAppendPlanNote = async (note: string) => {
        if (!planRuntime || !persistenceRoot) return;
        try {
          await appendPlanNote({
            persistenceRoot,
            sessionId: planRuntime.sessionId,
            note,
          });
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
          logger.debug(`[PlanRuntime] Failed to append note: ${msg}`);
          return false;
        }
      };

      try {
        this.ctxRef.current = ctx;
        const signal = (ctx as any)?.options?.signal as AbortSignal | undefined;
        const strategy = (ctx as any)?.workspace?.strategy ?? (ctx as any)?.options?.strategy;
        if (signal?.aborted && strategy === 'worktree') {
          abortedBeforeAction = true;
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

        if (abortedBeforeAction) {
          throw error;
        }

        // Trigger Recovery
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

          // 1. Record recovery failure to internal traces
          this.traces.push({
            name: `${name}:recovery`,
            start: recStart,
            end: recEnd,
            duration: recEnd - recStart,
            error: errorDetail,
            metadata: { success: false, phase: 'RECOVERY_FAILURE' },
          });

          // 2. Force audit log to disk (persistent storage)
          logger.audit(
            'PIPELINE_RECOVERY_FAILED',
            {
              step: name,
              originalError: errorStr,
              recoveryError: errorDetail,
            },
            { source: 'system', severity: 'high', scope: 'session' },
          );
        }

        throw error; // Propagate original error
      } finally {
        if (emit && isPhase(name) && phaseStarted) {
          emit({
            type: 'phase.end',
            phase: name,
            success: !errorStr,
            timestamp: new Date(),
          });
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
    });

    return new Pipeline(nextPromise, this.startTime, name, this.traces, this.ctxRef);
  }

  /**
   * Execute the pipeline and get the final result
   */
  async execute(): Promise<FlowReport<CurrentCtx>> {
    try {
      const data = await this.promise;
      return {
        success: true,
        duration: Date.now() - this.startTime,
        lastStep: this.lastStepName,
        data,
        traces: this.traces,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        lastStep: this.lastStepName,
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
