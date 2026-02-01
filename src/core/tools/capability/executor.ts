import { logger } from '../../logger.js';

import { Backend, BackendFail, BackendResult, CapabilityCtx } from './types.js';

export interface ExecutorOptions {
  /**
   * Fallback strategy: which failure codes should trigger a switch to the next backend.
   */
  fallbackOn: Set<BackendFail['code']>;

  /**
   * Maximum number of backends to try before giving up.
   */
  maxBackendTries: number;
}

export interface ExecutorRunMeta {
  tried: Array<{
    backendId: string;
    compatible: boolean;
    result: 'ok' | 'fail';
    failCode?: string;
    failMessage?: string;
  }>;
  chosenBackend?: string;
}

/**
 * Runs a capability with automatic fallback across multiple backends.
 */
export async function runWithFallback<I, O>(
  backends: Backend<I, O>[],
  input: I,
  ctx: CapabilityCtx,
  opts: ExecutorOptions,
): Promise<{ output: O; meta: ExecutorRunMeta }> {
  const meta: ExecutorRunMeta = { tried: [] };
  let tries = 0;

  for (const backend of backends) {
    if (tries >= opts.maxBackendTries) break;
    tries++;

    // 1. Compatibility Check
    let compatible = false;
    try {
      compatible = await backend.isCompatible(ctx);
    } catch (err) {
      logger.debug(`Compatibility check failed for backend ${backend.id}: ${err}`);
      compatible = false;
    }

    if (!compatible) {
      meta.tried.push({
        backendId: backend.id,
        compatible: false,
        result: 'fail',
        failCode: 'UNAVAILABLE',
      });
      continue;
    }

    // 2. Input Normalization
    const normalizedInput = backend.normalizeInput ? backend.normalizeInput(input) : input;

    // 3. Audit Start
    ctx.audit.event({
      type: 'tool.backend.start',
      backendId: backend.id,
      phase: ctx.phase,
      attemptId: ctx.attemptId,
    });

    // 4. Execution
    const res: BackendResult<O> = await backend.run(normalizedInput, ctx);

    if (res.ok) {
      // Success path
      meta.chosenBackend = backend.id;
      meta.tried.push({ backendId: backend.id, compatible: true, result: 'ok' });

      ctx.audit.event({
        type: 'tool.backend.ok',
        backendId: backend.id,
        phase: ctx.phase,
        attemptId: ctx.attemptId,
      });

      return { output: res.output, meta };
    }

    // 5. Failure Path
    meta.tried.push({
      backendId: backend.id,
      compatible: true,
      result: 'fail',
      failCode: res.code,
      failMessage: res.message,
    });

    ctx.audit.event({
      type: 'tool.backend.fail',
      backendId: backend.id,
      code: res.code,
      retryable: res.retryable,
      phase: ctx.phase,
      attemptId: ctx.attemptId,
    });

    // If the error code is not in the fallback list (e.g., BAD_INPUT), we stop immediately
    if (!opts.fallbackOn.has(res.code)) {
      throw createBackendError(backend.id, res, meta);
    }

    logger.warn(`Backend ${backend.id} failed with ${res.code}, attempting fallback...`);
  }

  throw new Error(`All backends failed for capability. Tried: ${JSON.stringify(meta.tried)}`);
}

function createBackendError(backendId: string, fail: BackendFail, meta: ExecutorRunMeta): Error {
  const error = new Error(`Backend ${backendId} failed: [${fail.code}] ${fail.message}`);
  (error as any).backendId = backendId;
  (error as any).failCode = fail.code;
  (error as any).meta = meta;
  return error;
}
