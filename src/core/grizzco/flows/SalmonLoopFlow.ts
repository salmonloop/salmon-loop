import { Pipeline, FlowReport } from '../engine/pipeline/pipeline.js';
import type { ExploreCtx, InitCtx, ReviewCtx, ShrinkCtx } from '../engine/pipeline/types.js';
import { runApplyBack } from '../steps/apply-back.js';
import { runApply } from '../steps/apply.js';
import { validateAst } from '../steps/ast-validate.js';
import { saveAudit } from '../steps/audit.js';
import { buildContext } from '../steps/context.js';
import { displayReview } from '../steps/displayReview.js';
import { exploreCodebase } from '../steps/explore.js';
import { extractIssues } from '../steps/extractIssues.js';
import { generateFixPlan } from '../steps/generateFixPlan.js';
import { generateReview } from '../steps/generateReview.js';
import { generatePatch } from '../steps/patch.js';
import { generatePlan } from '../steps/plan.js';
import { runPreflight } from '../steps/preflight.js';
import { runReviewShrink } from '../steps/review-shrink.js';
import { runRollback, runEmergencyRollback } from '../steps/rollback.js';
import { runShrink } from '../steps/shrink.js';
import { validatePatch } from '../steps/validate.js';
import { runVerify } from '../steps/verify.js';

export type FlowTerminalCtx = ReviewCtx | ShrinkCtx;

type ModePipeline = Pipeline<ReviewCtx> | Pipeline<ShrinkCtx>;

function buildBasePipeline(initCtx: InitCtx): Pipeline<ExploreCtx> {
  return Pipeline.of(initCtx)
    .step('PREFLIGHT', runPreflight)
    .step('CONTEXT', buildContext)
    .step('EXPLORE', exploreCodebase);
}

function buildPatchPipeline(base: Pipeline<ExploreCtx>): Pipeline<ShrinkCtx> {
  return base
    .step('PLAN', generatePlan)
    .step('PATCH', generatePatch)
    .step('VALIDATE', validatePatch)
    .step('AST_VALIDATE', validateAst)
    .stepWithRecovery('APPLY', runApply, runEmergencyRollback)
    .step('VERIFY', runVerify)
    .step('ROLLBACK', runRollback)
    .step('SHRINK', runShrink)
    .step('APPLY_BACK', runApplyBack);
}

function buildReviewPipeline(base: Pipeline<ExploreCtx>): Pipeline<ReviewCtx> {
  return base
    .step('REVIEW', generateReview)
    .step('REPORT', displayReview)
    .step('SHRINK', runReviewShrink);
}

function buildDebugPipeline(base: Pipeline<ExploreCtx>): Pipeline<ShrinkCtx> {
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
    .step('APPLY_BACK', runApplyBack);
}

function buildPipelineByMode(initCtx: InitCtx): ModePipeline {
  const basePipeline = buildBasePipeline(initCtx);

  if (initCtx.mode === 'review') {
    return buildReviewPipeline(basePipeline);
  }

  if (initCtx.mode === 'debug') {
    return buildDebugPipeline(basePipeline);
  }

  return buildPatchPipeline(basePipeline);
}

export async function executeSalmonLoopFlow(
  initCtx: InitCtx,
): Promise<FlowReport<FlowTerminalCtx>> {
  const pipeline = buildPipelineByMode(initCtx);
  const report = await pipeline.execute();

  // Save audit log
  report.auditPath = await saveAudit(report, initCtx.options);
  report.strategyName = initCtx.mode;
  report.fsMode = initCtx.mode;

  return report;
}
