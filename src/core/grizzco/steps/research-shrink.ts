import type { ResearchCtx } from '../engine/pipeline/types.js';

import { runReadOnlyShrink } from './read-only-shrink.js';

export async function runResearchShrink(ctx: ResearchCtx): Promise<ResearchCtx> {
  await runReadOnlyShrink(ctx);
  return ctx;
}
