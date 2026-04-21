import { Pipeline, type FlowReport } from '../engine/pipeline/pipeline.js';
import type { AutopilotCtx, InitCtx, TerminalCtx } from '../engine/pipeline/types.js';
import { saveAudit } from '../steps/audit.js';
import { runAutopilot, runAutopilotVerifyGate } from '../steps/autopilot.js';
import { displayReport } from '../steps/display-report.js';
import { runPreflight } from '../steps/preflight.js';

export async function executeAutopilotFlow(initCtx: InitCtx): Promise<FlowReport<TerminalCtx>> {
  const pipeline = Pipeline.of(initCtx)
    .step('PREFLIGHT', runPreflight)
    .step('AUTOPILOT', runAutopilot)
    .step('VERIFY_GATE', runAutopilotVerifyGate)
    .step('REPORT', displayReport);

  const report = await pipeline.execute();
  report.auditPath = await saveAudit(report, initCtx.options);
  report.strategyName = initCtx.mode;
  report.fsMode = initCtx.mode;

  return report as FlowReport<AutopilotCtx>;
}
