import { logger } from '../logger.js';
import { EXECUTION_PHASES, type ExecutionPhase, type LoopEvent } from '../types.js';

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
  metadata?: any;
}

/**
 * Execution Report
 */
export interface FlowReport<T = any> {
  success: boolean;
  error?: Error;
  lastStep?: string;
  duration: number;
  data?: T;
  traces: Span[];
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
      let errorStr: string | undefined;
      let errorMeta: any | undefined;
      let result;
      const emit = (ctx as any)?.emit as undefined | ((event: LoopEvent) => void);
      const isPhase = (value: string): value is ExecutionPhase =>
        (EXECUTION_PHASES as readonly string[]).includes(value);

      try {
        logger.debug(`[Pipeline] Step started: ${name}`);
        this.ctxRef.current = ctx;
        if (emit && isPhase(name)) {
          emit({ type: 'phase.start', phase: name, timestamp: new Date() });
        }
        result = await action(ctx);
        this.ctxRef.current = result;
        logger.debug(`[Pipeline] Step finished: ${name}`);
        return result;
      } catch (error) {
        errorStr = error instanceof Error ? error.message : String(error);
        errorMeta = {
          name: (error as any)?.name,
          code: (error as any)?.code,
          llmCode: (error as any)?.llmCode,
        };
        logger.error(`[Pipeline] Step failed: ${name} - ${errorStr}`);
        throw error;
      } finally {
        if (emit && isPhase(name)) {
          emit({
            type: 'phase.end',
            phase: name,
            success: !errorStr,
            timestamp: new Date(),
          });
        }
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
    recovery: Step<CurrentCtx, any>,
  ): Pipeline<NextCtx> {
    const nextPromise = this.promise.then(async (ctx) => {
      const start = Date.now();
      let errorStr: string | undefined;
      let errorMeta: any | undefined;
      let result;
      const emit = (ctx as any)?.emit as undefined | ((event: LoopEvent) => void);
      const isPhase = (value: string): value is ExecutionPhase =>
        (EXECUTION_PHASES as readonly string[]).includes(value);

      try {
        logger.debug(`[Pipeline] Step started: ${name}`);
        this.ctxRef.current = ctx;
        if (emit && isPhase(name)) {
          emit({ type: 'phase.start', phase: name, timestamp: new Date() });
        }
        result = await action(ctx);
        this.ctxRef.current = result;
        logger.debug(`[Pipeline] Step finished: ${name}`);
        return result;
      } catch (error) {
        errorStr = error instanceof Error ? error.message : String(error);
        errorMeta = {
          name: (error as any)?.name,
          code: (error as any)?.code,
          llmCode: (error as any)?.llmCode,
        };
        logger.error(`[Pipeline] Step failed: ${name} - ${errorStr}`);

        // Trigger Recovery
        logger.warn(`[Pipeline] Triggering recovery for ${name}`);
        try {
          const recStart = Date.now();
          await recovery(ctx);
          this.traces.push({
            name: `${name}:recovery`,
            start: recStart,
            end: Date.now(),
            duration: Date.now() - recStart,
          });
        } catch (recError) {
          const recMsg = recError instanceof Error ? recError.message : String(recError);
          logger.error(`[Pipeline] Recovery failed for ${name}: ${recMsg}`);
        }

        throw error; // Propagate original error
      } finally {
        if (emit && isPhase(name)) {
          emit({
            type: 'phase.end',
            phase: name,
            success: !errorStr,
            timestamp: new Date(),
          });
        }
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
        data: this.ctxRef.current as any,
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
}
