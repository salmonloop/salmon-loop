import { getExitCode, type LoopEvent, type LoopResult } from '../../core/facades/cli-headless.js';

type OutputTimestamp = string;

export interface StreamJsonEnvelope {
  uuid: string;
  session_id: string;
  event: Record<string, unknown>;
  parent_tool_use_id?: string | null;
}

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
  return getExitCode(result);
}

function extractParentToolUseId(event: LoopEvent): string | undefined {
  if (event.type === 'tool.call.start' || event.type === 'tool.call.end') return event.callId;
  return undefined;
}

function encodeEnvelope(params: {
  uuid: string;
  sessionId: string;
  event: Record<string, unknown>;
  parentToolUseId?: string | null;
}): StreamJsonEnvelope {
  return dropUndefined({
    uuid: params.uuid,
    session_id: params.sessionId,
    event: params.event,
    parent_tool_use_id: params.parentToolUseId,
  }) as StreamJsonEnvelope;
}

export function encodeStreamStart(params: {
  uuid: string;
  mode: 'run' | 'chat';
  repoPath?: string;
  sessionId: string;
  instruction?: string;
  at: Date;
}): StreamJsonEnvelope {
  return encodeEnvelope({
    uuid: params.uuid,
    sessionId: params.sessionId,
    event: dropUndefined({
      type: 'start',
      timestamp: toIso(params.at),
      command: params.mode,
      repo_path: params.repoPath,
      instruction: params.instruction,
    }) as any,
  });
}

export function encodeStreamEvent(params: {
  uuid: string;
  sessionId: string;
  at: Date;
  event: Record<string, unknown>;
  parentToolUseId?: string | null;
}): StreamJsonEnvelope {
  return encodeEnvelope({
    uuid: params.uuid,
    sessionId: params.sessionId,
    parentToolUseId: params.parentToolUseId,
    event: dropUndefined({
      ...params.event,
      timestamp: toIso(params.at),
    }) as any,
  });
}

export function encodeStreamLoopEvent(params: {
  uuid: string;
  sessionId: string;
  event: LoopEvent;
}): StreamJsonEnvelope {
  const parentToolUseId = extractParentToolUseId(params.event);
  return encodeEnvelope({
    uuid: params.uuid,
    sessionId: params.sessionId,
    parentToolUseId,
    event: dropUndefined({
      ...mapLoopEventToJson(params.event),
      timestamp: toIso(params.event.timestamp),
    }) as any,
  });
}

export function encodeStreamResult(params: {
  uuid: string;
  sessionId: string;
  loopResult: LoopResult;
  at: Date;
  resultText?: string;
}): StreamJsonEnvelope {
  const exitCode = getStreamExitCode(params.loopResult);
  return encodeEnvelope({
    uuid: params.uuid,
    sessionId: params.sessionId,
    event: dropUndefined({
      type: 'result',
      timestamp: toIso(params.at),
      success: Boolean(params.loopResult.success),
      exit_code: exitCode,
      reason: params.loopResult.safeHint ?? params.loopResult.reason,
      reason_code: params.loopResult.reasonCode,
      diagnostic_code: params.loopResult.diagnosticCode ?? params.loopResult.reasonCode,
      safe_hint: params.loopResult.safeHint ?? params.loopResult.reason,
      remediation_steps: params.loopResult.remediationSteps ?? [],
      attempts: params.loopResult.attempts,
      changed_files: params.loopResult.changedFiles,
      audit_path: params.loopResult.auditPath,
      error_code: params.loopResult.errorCode,
      authorization_summary: params.loopResult.authorizationSummary,
      result: params.resultText,
      run_end: {
        success: Boolean(params.loopResult.success),
        exit_code: exitCode,
        timestamp: toIso(params.at),
      },
    }) as any,
  });
}

export function encodeStreamFailure(params: {
  uuid: string;
  sessionId: string;
  at: Date;
  message: string;
  name?: string;
  stack?: string;
}): StreamJsonEnvelope {
  return encodeEnvelope({
    uuid: params.uuid,
    sessionId: params.sessionId,
    event: {
      type: 'error',
      timestamp: toIso(params.at),
      error: dropUndefined({
        name: params.name,
        message: params.message,
        stack: params.stack,
      }) as any,
    },
  });
}

export function encodeStreamCrash(params: {
  uuid: string;
  sessionId: string;
  at: Date;
  error: Error;
}): StreamJsonEnvelope {
  return encodeStreamFailure({
    uuid: params.uuid,
    sessionId: params.sessionId,
    at: params.at,
    message: params.error.message,
    name: params.error.name,
    stack: params.error.stack,
  });
}

export function encodeStreamEnd(params: {
  uuid: string;
  sessionId: string;
  at: Date;
  success: boolean;
  exitCode: number;
}): StreamJsonEnvelope {
  return encodeEnvelope({
    uuid: params.uuid,
    sessionId: params.sessionId,
    event: {
      type: 'end',
      timestamp: toIso(params.at),
      success: params.success,
      exit_code: params.exitCode,
    },
  });
}
