import type { Step } from '../engine/pipeline/pipeline.js';
import type { ReviewCtx } from '../engine/pipeline/types.js';

export const runReviewShrink: Step<ReviewCtx, ReviewCtx> = async (ctx) => ctx;
