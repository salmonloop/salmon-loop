import { Pipeline, FlowReport } from '../pipeline.js';
import { runApply } from '../steps/apply.js';
import { validateAst } from '../steps/ast-validate.js';
import { saveAudit } from '../steps/audit.js';
import { buildContext } from '../steps/context.js';
import { exploreCodebase } from '../steps/explore.js';
import { generatePatch } from '../steps/patch.js';
import { generatePlan } from '../steps/plan.js';
import { runPreflight } from '../steps/preflight.js';
import { runRollback, runEmergencyRollback } from '../steps/rollback.js';
import { runShrink } from '../steps/shrink.js';
import { validatePatch } from '../steps/validate.js';
import { runVerify } from '../steps/verify.js';
import { InitCtx } from '../types.js';

import { initializeFlowStrategies } from './registry.js';
import { flowRegistry } from './strategy-registry.js';

export async function executeSalmonLoopFlow(initCtx: InitCtx): Promise<FlowReport> {
  initializeFlowStrategies();

  const basePipeline = Pipeline.of(initCtx)
    .step('PREFLIGHT', runPreflight)
    .step('CONTEXT', buildContext)
    .step('EXPLORE', exploreCodebase);

  const strategy = flowRegistry.get(initCtx.mode);
  const pipeline = strategy.buildPipeline(basePipeline);

  const report = await pipeline.execute();

  // Save audit log
  report.auditPath = await saveAudit(report, initCtx.options);
  report.strategyName = strategy.name;
  report.fsMode = initCtx.mode;

  return report;
}

/** @deprecated Use executeSalmonLoopFlow with FlowStrategy instead. */
export async function executeSalmonLoopFlowLegacy(initCtx: InitCtx): Promise<FlowReport> {
  const pipeline = Pipeline.of(initCtx)
    .step('PREFLIGHT', runPreflight)
    .step('CONTEXT', buildContext)
    .step('PLAN', generatePlan)
    .step('PATCH', generatePatch)
    .step('VALIDATE', validatePatch)
    .step('AST_VALIDATE', validateAst)
    .stepWithRecovery('APPLY', runApply, runEmergencyRollback)
    .step('VERIFY', runVerify)
    .step('ROLLBACK', runRollback)
    .step('SHRINK', runShrink);

  const report = await pipeline.execute();

  report.auditPath = await saveAudit(report, initCtx.options);
  report.strategyName = 'legacy-patch';
  report.fsMode = 'patch';

  return report;
}
