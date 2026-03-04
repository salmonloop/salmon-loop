import { getExitCode } from '../../core/runtime/exit-codes.js';
import type { LoopResult } from '../../core/types/loop.js';

export type AnthropicStreamLine =
  | {
      type: 'start';
      session_id: string;
      command: 'run' | 'chat';
      repo_path?: string;
      instruction?: string;
    }
  | {
      type: 'stream_event';
      session_id: string;
      event: Record<string, unknown>;
      parent_tool_use_id?: string;
    }
  | {
      type: 'result';
      session_id: string;
      success: boolean;
      exit_code: number;
      reason?: string;
      result?: string;
    }
  | {
      type: 'error';
      session_id: string;
      error: {
        message: string;
        name?: string;
        stack?: string;
      };
    }
  | {
      type: 'end';
      session_id: string;
      success: boolean;
      exit_code: number;
    };

function dropUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    (out as any)[key] = value;
  }
  return out;
}

export function getAnthropicExitCode(result: Partial<LoopResult>): number {
  return getExitCode(result);
}

export function encodeAnthropicStart(params: {
  sessionId: string;
  mode: 'run' | 'chat';
  repoPath?: string;
  instruction?: string;
}): AnthropicStreamLine {
  return dropUndefined({
    type: 'start',
    session_id: params.sessionId,
    command: params.mode,
    repo_path: params.repoPath,
    instruction: params.instruction,
  }) as AnthropicStreamLine;
}

export function encodeAnthropicStreamEvent(params: {
  sessionId: string;
  event: Record<string, unknown>;
  parentToolUseId?: string;
}): AnthropicStreamLine {
  return dropUndefined({
    type: 'stream_event',
    session_id: params.sessionId,
    event: params.event,
    parent_tool_use_id: params.parentToolUseId,
  }) as AnthropicStreamLine;
}

export function encodeAnthropicResult(params: {
  sessionId: string;
  loopResult: LoopResult;
  resultText?: string;
}): AnthropicStreamLine {
  const exitCode = getAnthropicExitCode(params.loopResult);
  return dropUndefined({
    type: 'result',
    session_id: params.sessionId,
    success: Boolean(params.loopResult.success),
    exit_code: exitCode,
    reason: params.loopResult.reason,
    result: params.resultText,
  }) as AnthropicStreamLine;
}

export function encodeAnthropicError(params: {
  sessionId: string;
  message: string;
  name?: string;
  stack?: string;
}): AnthropicStreamLine {
  return {
    type: 'error',
    session_id: params.sessionId,
    error: dropUndefined({
      message: params.message,
      name: params.name,
      stack: params.stack,
    }) as any,
  };
}

export function encodeAnthropicEnd(params: {
  sessionId: string;
  loopResult: Partial<LoopResult>;
}): AnthropicStreamLine {
  const exitCode = getAnthropicExitCode(params.loopResult);
  return {
    type: 'end',
    session_id: params.sessionId,
    success: Boolean(params.loopResult.success),
    exit_code: exitCode,
  };
}
