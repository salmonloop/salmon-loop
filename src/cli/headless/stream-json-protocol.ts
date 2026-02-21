import type { LoopEvent, LoopResult } from '../../core/types/index.js';

type OutputTimestamp = string;

export type StreamJsonLine =
  | {
      type: 'start';
      session_id: string;
      timestamp: OutputTimestamp;
      command: 'run' | 'chat';
      repo_path?: string;
      instruction?: string;
    }
  | {
      type: 'loop_event';
      session_id: string;
      timestamp: OutputTimestamp;
      event: Record<string, unknown>;
    }
  | {
      type: 'stream_event';
      session_id: string;
      timestamp: OutputTimestamp;
      event: Record<string, unknown>;
    }
  | {
      type: 'result';
      session_id: string;
      timestamp: OutputTimestamp;
      success: boolean;
      exit_code: number;
      reason?: string;
      reason_code?: string;
      attempts?: number;
      changed_files?: string[];
      audit_path?: string;
      error_code?: string;
      result?: string;
      authorization_summary?: LoopResult['authorizationSummary'];
    }
  | {
      type: 'error';
      session_id: string;
      timestamp: OutputTimestamp;
      error: { name?: string; message: string; stack?: string };
    }
  | {
      type: 'end';
      session_id: string;
      timestamp: OutputTimestamp;
      success: boolean;
      exit_code: number;
    };

function toIso(date: Date): OutputTimestamp {
  return date.toISOString();
}

function dropUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    (out as any)[key] = value;
  }
  return out;
}

function mapLoopEventToJson(event: LoopEvent): Record<string, unknown> {
  const { timestamp: _ts, ...rest } = event as any;
  return dropUndefined(rest);
}

export function getStreamExitCode(result: Partial<LoopResult>): number {
  if (result.reason === 'Operation cancelled by user') return 130;
  return result.success ? 0 : 1;
}

export function encodeStreamStart(params: {
  mode: 'run' | 'chat';
  repoPath?: string;
  sessionId: string;
  instruction?: string;
  at: Date;
}): StreamJsonLine {
  return dropUndefined({
    type: 'start',
    session_id: params.sessionId,
    timestamp: toIso(params.at),
    command: params.mode,
    repo_path: params.repoPath,
    instruction: params.instruction,
  }) as any;
}

export function encodeStreamEvent(params: {
  sessionId: string;
  at: Date;
  event: Record<string, unknown>;
}): StreamJsonLine {
  return {
    type: 'stream_event',
    session_id: params.sessionId,
    timestamp: toIso(params.at),
    event: params.event,
  };
}

export function encodeStreamLoopEvent(params: {
  sessionId: string;
  event: LoopEvent;
}): StreamJsonLine {
  return {
    type: 'loop_event',
    session_id: params.sessionId,
    timestamp: toIso(params.event.timestamp),
    event: mapLoopEventToJson(params.event),
  };
}

export function encodeStreamResult(params: {
  sessionId: string;
  loopResult: LoopResult;
  at: Date;
  resultText?: string;
}): StreamJsonLine {
  const exitCode = getStreamExitCode(params.loopResult);
  return dropUndefined({
    type: 'result',
    session_id: params.sessionId,
    timestamp: toIso(params.at),
    success: Boolean(params.loopResult.success),
    exit_code: exitCode,
    reason: params.loopResult.reason,
    reason_code: params.loopResult.reasonCode,
    attempts: params.loopResult.attempts,
    changed_files: params.loopResult.changedFiles,
    audit_path: params.loopResult.auditPath,
    error_code: params.loopResult.errorCode,
    authorization_summary: params.loopResult.authorizationSummary,
    result: params.resultText,
  }) as any;
}

export function encodeStreamFailure(params: {
  sessionId: string;
  at: Date;
  message: string;
  name?: string;
  stack?: string;
}): StreamJsonLine {
  return {
    type: 'error',
    session_id: params.sessionId,
    timestamp: toIso(params.at),
    error: dropUndefined({
      name: params.name,
      message: params.message,
      stack: params.stack,
    }) as any,
  };
}

export function encodeStreamCrash(params: {
  sessionId: string;
  at: Date;
  error: Error;
}): StreamJsonLine {
  return encodeStreamFailure({
    sessionId: params.sessionId,
    at: params.at,
    message: params.error.message,
    name: params.error.name,
    stack: params.error.stack,
  });
}

export function encodeStreamEnd(params: {
  sessionId: string;
  at: Date;
  success: boolean;
  exitCode: number;
}): StreamJsonLine {
  return {
    type: 'end',
    session_id: params.sessionId,
    timestamp: toIso(params.at),
    success: params.success,
    exit_code: params.exitCode,
  };
}
