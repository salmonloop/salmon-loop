import { buildFlowTransactionRunner, runFlowSession } from '../grizzco/engine/transaction/index.js';
import type { LoopOptions, LoopResult } from '../types/runtime.js';

import type { LoopLifecycleContext } from './loop-run-lifecycle.js';

export interface LoopSessionExecutionResult {
  result: LoopResult;
  auditPath?: string;
}

export async function executeLoopSession(params: {
  options: LoopOptions;
  lifecycle: LoopLifecycleContext;
  latestAuditPath?: string;
}): Promise<LoopSessionExecutionResult> {
  const hostContext = await params.lifecycle.hostRunner.boot();
  const runner = buildFlowTransactionRunner({
    flowMode: hostContext.flowMode,
    fsAdapter: hostContext.fsAdapter,
    env: hostContext.env,
    activeRepoPath: hostContext.activeRepoPath,
    planRuntime: hostContext.planRuntime,
    options: params.options,
    emitFlow: params.lifecycle.emitFlow,
    now: params.lifecycle.now,
    telemetry: params.lifecycle.telemetry,
    shadowTaskId: params.lifecycle.shadowTaskId,
  });

  const sessionResult = await runFlowSession({
    runner,
    flowMode: hostContext.flowMode,
    options: params.options,
    telemetry: params.lifecycle.telemetry,
    now: params.lifecycle.now,
    emitSanitized: params.lifecycle.emitSanitized,
    auditPath: params.latestAuditPath,
  });

  return {
    result: sessionResult.result,
    auditPath: sessionResult.auditPath,
  };
}
