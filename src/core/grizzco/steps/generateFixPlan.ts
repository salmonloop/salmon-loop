import { text } from '../../../locales/index.js';
import type { PlanCtx, ReviewCtx } from '../types.js';

import { generatePlan } from './plan.js';

export async function generateFixPlan(ctx: ReviewCtx): Promise<PlanCtx> {
  const planCtx = await generatePlan(ctx);

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.grizzco.review.fixPlanGenerated,
    timestamp: new Date(),
  });

  return planCtx;
}
