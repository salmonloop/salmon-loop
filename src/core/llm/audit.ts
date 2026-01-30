import type { ExecutionPhase } from '../types.js';

export interface ToolCallingAuditEntry {
  timestamp: string;
  phase: ExecutionPhase;
  round: number;
  callId: string;
  toolName: string;
  rawArgsType: string;
  rawArgsPreview?: string;
  parsedArgsOk: boolean;
  parsedArgsPreview?: string;
  parsedArgsError?: string;
  toolResultStatus?: string;
  toolResultErrorCode?: string;
}

export interface ToolCallingAuditSink {
  event(entry: ToolCallingAuditEntry): void;
}
