import type { ReportableCtx } from '../engine/pipeline/types.js';

export async function runReadOnlyShrink<T extends ReportableCtx>(ctx: T): Promise<T> {
  return ctx;
}
