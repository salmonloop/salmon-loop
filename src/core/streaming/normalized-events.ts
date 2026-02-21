import type { ExecutionPhase, LoopEvent, LoopResult } from '../types/index.js';

export type NormalizedStopReason = 'end_turn' | 'tool_use' | 'error' | 'cancelled' | 'unknown';

export type NormalizedMessageRole = 'assistant' | 'user';

export type NormalizedMessageSource = 'llm' | 'tool';

export type NormalizedContentBlockType = 'text' | 'tool_use' | 'tool_result';

export interface NormalizedBaseEvent {
  timestamp: Date;
}

export type NormalizedStreamEvent =
  | ({
      type: 'normalized.run_start';
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.run_end';
      success: boolean;
      exitCode: number;
      reason?: string;
      reasonCode?: LoopResult['reasonCode'];
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.message_start';
      messageId: string;
      role: NormalizedMessageRole;
      source: NormalizedMessageSource;
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.content_block_start';
      messageId: string;
      blockId: string;
      blockType: NormalizedContentBlockType;
      index: number;
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.content_block_delta';
      messageId: string;
      blockId: string;
      index: number;
      deltaType: 'text';
      text: string;
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.content_block_end';
      messageId: string;
      blockId: string;
      index: number;
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.message_end';
      messageId: string;
      stopReason: NormalizedStopReason;
      finishReason?: string;
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.tool_call_start';
      callId: string;
      toolName: string;
      phase: ExecutionPhase;
      round: number;
      input?: unknown;
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.tool_call_end';
      callId: string;
      toolName: string;
      phase: ExecutionPhase;
      round: number;
      status: Extract<LoopEvent, { type: 'tool.call.end' }>['status'];
      durationMs?: number;
      errorCode?: string;
      outputSummary?: string;
    } & NormalizedBaseEvent)
  | ({
      /**
       * Model-side tool call request lifecycle.
       *
       * This is distinct from the host-side execution timeline:
       * - `normalized.tool_request_*`: model asked for a tool call in its output stream.
       * - `normalized.tool_call_*`: host began/ended executing the requested tool.
       */
      type: 'normalized.tool_request_start';
      callId: string;
      toolName: string;
      phase: ExecutionPhase;
      round: number;
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.tool_request_end';
      callId: string;
      toolName: string;
      phase: ExecutionPhase;
      round: number;
    } & NormalizedBaseEvent)
  | ({
      type: 'normalized.error';
      code: string;
      message: string;
    } & NormalizedBaseEvent);

export function normalizeStopReason(raw?: string): NormalizedStopReason {
  if (raw === 'end_turn' || raw === 'tool_use' || raw === 'error' || raw === 'cancelled') {
    return raw;
  }
  if (raw) return 'unknown';
  return 'end_turn';
}
