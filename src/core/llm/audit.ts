import type { ToolIntent } from '../tools/types.js';
import type { ExecutionPhase } from '../types/index.js';

export interface ToolCallingAuditEntry {
  timestamp: string;
  phase: ExecutionPhase;
  round: number;
  callId: string;
  toolName: string;
  toolIntent?: ToolIntent;
  rawArgsType: string;
  rawArgsPreview?: string;
  parsedArgsOk: boolean;
  parsedArgsPreview?: string;
  parsedArgsError?: string;
  toolResultStatus?: string;
  toolResultErrorCode?: string;
  toolResultErrorMessage?: string;
}

export interface ToolCallingAuditSink {
  event(entry: ToolCallingAuditEntry): void;
}
