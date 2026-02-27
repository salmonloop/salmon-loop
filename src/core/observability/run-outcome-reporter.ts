import type { ExecutionPhase, LoopReasonCode, LoopResult } from '../types/index.js';

export interface RunOutcomeContext {
  runId: string;
  auditPath?: string;
  mode?: string;
  repoPath?: string;
  sessionId?: string;
  userId?: string;
  instruction?: string;
  verify?: string;
}

export interface RunOutcomeReport {
  success: boolean;
  reason: string;
  reasonCode: LoopReasonCode;
  diagnosticCode?: string;
  safeHint?: string;
  remediationSteps?: string[];
  attempts: number;
  failurePhase?: ExecutionPhase;
  errorCode?: string;
  changedFiles?: string[];
}

export interface RunOutcomeReporter {
  report(report: RunOutcomeReport, ctx: RunOutcomeContext): Promise<void>;
}

export function buildRunOutcomeReport(result: LoopResult): RunOutcomeReport {
  return {
    success: result.success,
    reason: result.reason,
    reasonCode: result.reasonCode,
    diagnosticCode: result.diagnosticCode,
    safeHint: result.safeHint,
    remediationSteps: result.remediationSteps,
    attempts: result.attempts,
    failurePhase: result.failurePhase,
    errorCode: result.errorCode,
    changedFiles: result.changedFiles,
  };
}
