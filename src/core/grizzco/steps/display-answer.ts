import type { AnswerCtx } from '../engine/pipeline/types.js';

import { displayReport } from './display-report.js';

export async function displayAnswer(ctx: AnswerCtx): Promise<AnswerCtx> {
  await displayReport(ctx);
  return ctx;
}
