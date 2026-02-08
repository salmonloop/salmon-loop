import type { FlowMode } from '../../types.js';
import type { Pipeline } from '../pipeline.js';
import { runApply } from '../steps/apply.js';
import { validateAst } from '../steps/ast-validate.js';
import { displayReview } from '../steps/displayReview.js';
import { extractIssues } from '../steps/extractIssues.js';
import { generateFixPlan } from '../steps/generateFixPlan.js';
import { generateReview } from '../steps/generateReview.js';
import { generatePatch } from '../steps/patch.js';
import { generatePlan } from '../steps/plan.js';
import { runReviewShrink } from '../steps/review-shrink.js';
import { runRollback, runEmergencyRollback } from '../steps/rollback.js';
import { runShrink } from '../steps/shrink.js';
import { validatePatch } from '../steps/validate.js';
import { runVerify } from '../steps/verify.js';
import type { ExploreCtx } from '../types.js';

import type { FlowStrategy } from './strategy-registry.js';

export class PatchFlowStrategy implements FlowStrategy {
  readonly name: FlowMode = 'patch';

  buildPipeline(base: Pipeline<ExploreCtx>): Pipeline<unknown> {
    return base
      .step('PLAN', generatePlan)
      .step('PATCH', generatePatch)
      .step('VALIDATE', validatePatch)
      .step('AST_VALIDATE', validateAst)
      .stepWithRecovery('APPLY', runApply, runEmergencyRollback)
      .step('VERIFY', runVerify)
      .step('ROLLBACK', runRollback)
      .step('SHRINK', runShrink)
      .cast<unknown>();
  }
}

export class ReviewFlowStrategy implements FlowStrategy {
  readonly name: FlowMode = 'review';

  buildPipeline(base: Pipeline<ExploreCtx>): Pipeline<unknown> {
    return base
      .step('REVIEW', generateReview)
      .step('REPORT', displayReview)
      .step('SHRINK', runReviewShrink)
      .cast<unknown>();
  }
}

export class DebugFlowStrategy implements FlowStrategy {
  readonly name: FlowMode = 'debug';

  buildPipeline(base: Pipeline<ExploreCtx>): Pipeline<unknown> {
    return base
      .step('REVIEW', generateReview)
      .step('ANALYZE_ISSUES', extractIssues)
      .step('PLAN', generateFixPlan)
      .step('PATCH', generatePatch)
      .step('VALIDATE', validatePatch)
      .step('AST_VALIDATE', validateAst)
      .stepWithRecovery('APPLY', runApply, runEmergencyRollback)
      .step('VERIFY', runVerify)
      .step('ROLLBACK', runRollback)
      .step('SHRINK', runShrink)
      .cast<unknown>();
  }
}
