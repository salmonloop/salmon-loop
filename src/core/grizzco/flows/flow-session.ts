import { sanitizeError } from '../../llm/errors.js';
import { Phase } from '../../types.js';
import type { FlowMode, LoopEvent, LoopOptions, LoopResult } from '../../types.js';

import { buildLoopFailureResult, buildLoopResultFromTransaction } from './flow-result-factory.js';
import { LoopTelemetry } from './flow-telemetry.js';
import { FlowTransactionCancelledError, FlowTransactionRunner } from './flow-transaction-runner.js';

export interface FlowSessionParams {
  runner: FlowTransactionRunner;
  flowMode: FlowMode;
  options: LoopOptions;
  telemetry: LoopTelemetry;
  now: () => Date;
  emitSanitized: (event: LoopEvent) => void;
  auditPath?: string;
}

export interface FlowSessionResult {
  result: LoopResult;
  auditPath?: string;
}

export async function runFlowSession(params: FlowSessionParams): Promise<FlowSessionResult> {
  const { runner, flowMode, options, telemetry, now, emitSanitized } = params;
  let auditPath = params.auditPath;

  try {
    const executionReport = await runner.execute();
    auditPath = executionReport.flowReport.auditPath ?? auditPath;

    return {
      result: buildLoopResultFromTransaction({
        executionReport,
        flowMode,
        options,
        telemetry,
        auditPath,
      }),
      auditPath,
    };
  } catch (error) {
    if (error instanceof FlowTransactionCancelledError) {
      const message = error.message;
      telemetry.recordLog('error', message, false);
      emitSanitized({ type: 'log', level: 'error', message, timestamp: now() });
      return {
        result: buildLoopFailureResult({
          message,
          flowMode,
          telemetry,
          auditPath,
          reasonCode: 'LOOP_CRASH',
        }),
        auditPath,
      };
    }

    const message = sanitizeError(error);
    telemetry.recordLog('error', message, false);
    emitSanitized({ type: 'log', level: 'error', message, timestamp: now() });
    return {
      result: buildLoopFailureResult({
        message,
        flowMode,
        telemetry,
        auditPath,
        reasonCode: 'LOOP_CRASH',
        failurePhase: Phase.VERIFY,
      }),
      auditPath,
    };
  }
}
