import type { ArtifactHandle } from '../../../sub-agent/artifacts/types.js';
import type { AuthorizationSourceSummary, LoopIteration } from '../../../types/runtime.js';
import type { FlowReport } from '../pipeline/pipeline.js';
import type { ShrinkCtx } from '../pipeline/types.js';

import type { AttemptFailureDetails } from './attempt-failure.js';
import type { FlowTransactionReport } from './types.js';

interface TransactionReportBase {
  attempt: number;
  flowReport: FlowReport;
  history: LoopIteration[];
  authorizationSummary: AuthorizationSourceSummary | null;
  lastContext?: ShrinkCtx;
  lastVerifyArtifact?: ArtifactHandle;
}

export function mapSuccessReport(
  params: TransactionReportBase & {
    lastErrorCode?: string;
  },
): FlowTransactionReport {
  const {
    attempt,
    flowReport,
    history,
    authorizationSummary,
    lastContext,
    lastVerifyArtifact,
    lastErrorCode,
  } = params;

  return {
    success: true,
    attempts: attempt,
    flowReport,
    history: [...history],
    authorizationSummary,
    lastErrorCode,
    retryExhausted: false,
    lastContext,
    lastVerifyArtifact,
  };
}

export function mapTerminalFailureReport(
  params: TransactionReportBase & {
    failure: AttemptFailureDetails;
    lastErrorCode?: string;
  },
): FlowTransactionReport {
  const {
    attempt,
    flowReport,
    history,
    authorizationSummary,
    lastContext,
    lastVerifyArtifact,
    failure,
    lastErrorCode,
  } = params;

  return {
    success: false,
    attempts: attempt,
    flowReport,
    history: [...history],
    authorizationSummary,
    lastErrorCode,
    retryExhausted: false,
    lastContext,
    lastVerifyArtifact,
    terminalReason: failure.reason,
    terminalReasonCode: failure.reasonCode,
    terminalFailurePhase: failure.failurePhase,
    terminalDiagnosticCode: failure.diagnosticCode,
    terminalSafeHint: failure.safeHint,
    terminalRemediationSteps: [...failure.remediationSteps],
    terminalInputRequired: failure.inputRequired,
  };
}

export function mapRetryExhaustedReport(params: {
  attempts: number;
  flowReport: FlowReport;
  history: LoopIteration[];
  authorizationSummary: AuthorizationSourceSummary | null;
  lastErrorCode?: string;
  lastContext?: ShrinkCtx;
  lastVerifyArtifact?: ArtifactHandle;
}): FlowTransactionReport {
  const {
    attempts,
    flowReport,
    history,
    authorizationSummary,
    lastErrorCode,
    lastContext,
    lastVerifyArtifact,
  } = params;

  return {
    success: false,
    attempts,
    flowReport,
    history: [...history],
    authorizationSummary,
    lastErrorCode,
    retryExhausted: true,
    lastContext,
    lastVerifyArtifact,
  };
}
