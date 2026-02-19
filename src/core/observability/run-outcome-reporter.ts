import type { ExecutionPhase, LoopReasonCode, LoopResult } from '../types/index.js';

export interface RunOutcomeContext {
  runId: string;
  auditPath?: string;
  mode?: string;
  repoPath?: string;
  sessionId?: string;
  userId?: string;
}

export interface RunOutcomeReport {
  success: boolean;
  reason: string;
  reasonCode: LoopReasonCode;
  attempts: number;
  failurePhase?: ExecutionPhase;
  errorCode?: string;
}

export interface RunOutcomeReporter {
  report(report: RunOutcomeReport, ctx: RunOutcomeContext): Promise<void>;
}

export function buildRunOutcomeReport(result: LoopResult): RunOutcomeReport {
  return {
    success: result.success,
    reason: result.reason,
    reasonCode: result.reasonCode,
    attempts: result.attempts,
    failurePhase: result.failurePhase,
    errorCode: result.errorCode,
  };
}
