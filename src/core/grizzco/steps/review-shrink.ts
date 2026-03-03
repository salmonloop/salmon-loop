import type { Step } from '../engine/pipeline/pipeline.js';
import type { ReviewCtx } from '../engine/pipeline/types.js';

import { runReadOnlyShrink } from './read-only-shrink.js';

export const runReviewShrink: Step<ReviewCtx, ReviewCtx> = async (ctx) => {
  await runReadOnlyShrink(ctx);
  return ctx;
};
