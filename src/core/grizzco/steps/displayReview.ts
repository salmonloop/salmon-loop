import type { ReviewCtx } from '../engine/pipeline/types.js';

import { displayReport } from './display-report.js';

export async function displayReview(ctx: ReviewCtx): Promise<ReviewCtx> {
  await displayReport(ctx);
  return ctx;
}
