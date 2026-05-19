import type { ArtifactHandle } from '../../../sub-agent/artifacts/types.js';
import type { AuthorizationSourceSummary, LoopIteration } from '../../../types/runtime.js';
import type { FlowReport } from '../pipeline/pipeline.js';
import type { TerminalCtx } from '../pipeline/types.js';

import type { AttemptFailureDetails } from './attempt-failure.js';
import type { FlowTransactionReport } from './types.js';

interface TransactionReportBase {
  attempt: number;
  flowReport: FlowReport;
  history: LoopIteration[];
  authorizationSummary: AuthorizationSourceSummary | null;
  lastContext?: TerminalCtx;
  lastVerifyArtifact?: ArtifactHandle;
  lastSubAgentPatchArtifacts?: ArtifactHandle[];
  lastSubAgentAuditArtifacts?: ArtifactHandle[];
  lastRecentReadArtifacts?: Array<{ path: string; artifact: ArtifactHandle }>;
  lastToolResultPreviewArtifacts?: Array<{ label: string; artifact: ArtifactHandle }>;
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
    lastSubAgentPatchArtifacts,
    lastSubAgentAuditArtifacts,
    lastRecentReadArtifacts,
    lastToolResultPreviewArtifacts,
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
    lastSubAgentPatchArtifacts,
    lastSubAgentAuditArtifacts,
    lastRecentReadArtifacts,
    lastToolResultPreviewArtifacts,
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
    lastSubAgentPatchArtifacts,
    lastSubAgentAuditArtifacts,
    lastRecentReadArtifacts,
    lastToolResultPreviewArtifacts,
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
    lastSubAgentPatchArtifacts,
    lastSubAgentAuditArtifacts,
    lastRecentReadArtifacts,
    lastToolResultPreviewArtifacts,
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
  failure?: AttemptFailureDetails;
  lastErrorCode?: string;
  lastContext?: TerminalCtx;
  lastVerifyArtifact?: ArtifactHandle;
  lastSubAgentPatchArtifacts?: ArtifactHandle[];
  lastSubAgentAuditArtifacts?: ArtifactHandle[];
  lastRecentReadArtifacts?: Array<{ path: string; artifact: ArtifactHandle }>;
  lastToolResultPreviewArtifacts?: Array<{ label: string; artifact: ArtifactHandle }>;
}): FlowTransactionReport {
  const {
    attempts,
    flowReport,
    history,
    authorizationSummary,
    failure,
    lastErrorCode,
    lastContext,
    lastVerifyArtifact,
    lastSubAgentPatchArtifacts,
    lastSubAgentAuditArtifacts,
    lastRecentReadArtifacts,
    lastToolResultPreviewArtifacts,
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
    lastSubAgentPatchArtifacts,
    lastSubAgentAuditArtifacts,
    lastRecentReadArtifacts,
    lastToolResultPreviewArtifacts,
    terminalFailurePhase: failure?.failurePhase,
    terminalReasonCode: failure?.reasonCode,
    terminalDiagnosticCode: failure?.diagnosticCode,
    terminalSafeHint: failure?.safeHint,
    terminalRemediationSteps: failure ? [...failure.remediationSteps] : undefined,
  };
}
