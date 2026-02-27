import type { ArtifactHandle } from '../../../sub-agent/artifacts/types.js';
import type {
  AuthorizationSourceSummary,
  ExecutionPhase,
  LoopIteration,
  LoopReasonCode,
} from '../../../types/index.js';
import type { FlowReport } from '../pipeline/pipeline.js';
import type { ShrinkCtx } from '../pipeline/types.js';

export interface FlowTransactionReport {
  success: boolean;
  attempts: number;
  flowReport: FlowReport;
  history: LoopIteration[];
  authorizationSummary?: AuthorizationSourceSummary | null;
  lastErrorCode?: string;
  retryExhausted: boolean;
  lastContext?: ShrinkCtx | undefined;
  lastVerifyArtifact?: ArtifactHandle;
  terminalReason?: string;
  terminalReasonCode?: LoopReasonCode;
  terminalFailurePhase?: ExecutionPhase;
  terminalDiagnosticCode?: string;
  terminalSafeHint?: string;
  terminalRemediationSteps?: string[];
}
