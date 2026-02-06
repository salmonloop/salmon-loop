import type { Step } from '../pipeline.js';
import type { ReviewCtx } from '../types.js';

export const runReviewShrink: Step<ReviewCtx, ReviewCtx> = async (ctx) => ctx;
