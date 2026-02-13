import type { ArtifactHandle } from '../../../sub-agent/artifacts/types.js';
import type {
  AuthorizationSourceSummary,
  ExecutionPhase,
  LoopIteration,
  LoopReasonCode,
} from '../../../types.js';
import type { FlowReport } from '../../pipeline.js';
import type { ShrinkCtx } from '../../types.js';

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
}
