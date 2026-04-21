import type { FlowReport } from '../engine/pipeline/pipeline.js';
import type { InitCtx, TerminalCtx } from '../engine/pipeline/types.js';
import { resolveExecutionProfile } from '../../runtime/execution-profile.js';

import { executeAutopilotFlow } from './AutopilotFlow.js';
import { executeSalmonLoopFlow } from './SalmonLoopFlow.js';

export async function executeFlowAttempt(initCtx: InitCtx): Promise<FlowReport<TerminalCtx>> {
  const profile = resolveExecutionProfile(initCtx.mode);

  if (profile.driver === 'agent') {
    return executeAutopilotFlow(initCtx);
  }

  return executeSalmonLoopFlow(initCtx);
}
