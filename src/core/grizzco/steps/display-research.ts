import type { ResearchCtx } from '../engine/pipeline/types.js';

import { displayReport } from './display-report.js';

export async function displayResearch(ctx: ResearchCtx): Promise<ResearchCtx> {
  await displayReport(ctx);
  return ctx;
}
