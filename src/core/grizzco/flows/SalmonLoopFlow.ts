import { Pipeline, FlowReport } from '../pipeline.js';
import { runApply } from '../steps/apply.js';
import { validateAst } from '../steps/ast-validate.js';
import { saveAudit } from '../steps/audit.js';
import { buildContext } from '../steps/context.js';
import { generatePatch } from '../steps/patch.js';
import { generatePlan } from '../steps/plan.js';
import { runPreflight } from '../steps/preflight.js';
import { runRollback, runEmergencyRollback } from '../steps/rollback.js';
import { runShrink } from '../steps/shrink.js';
import { validatePatch } from '../steps/validate.js';
import { runVerify } from '../steps/verify.js';
import { InitCtx } from '../types.js';

export async function executeSalmonLoopFlow(initCtx: InitCtx): Promise<FlowReport> {
  const pipeline = Pipeline.of(initCtx)
    .step('PREFLIGHT', runPreflight)
    .step('CONTEXT', buildContext)
    .step('PLAN', generatePlan)
    .step('PATCH', generatePatch)
    .step('VALIDATE', validatePatch)
    .step('AST_VALIDATE', validateAst)
    // Use stepWithRecovery for APPLY to handle execution crashes
    .stepWithRecovery('APPLY', runApply, runEmergencyRollback)
    .step('VERIFY', runVerify)
    .step('ROLLBACK', runRollback)
    .step('SHRINK', runShrink);

  const report = await pipeline.execute();

  // Save audit log
  report.auditPath = await saveAudit(report, initCtx.options);

  return report;
}
