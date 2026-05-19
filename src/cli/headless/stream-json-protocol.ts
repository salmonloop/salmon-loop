import { getExitCode, type LoopEvent, type LoopResult } from '../../core/facades/cli-headless.js';

import {
  HEADLESS_NATIVE_STREAM_PROTOCOL_VERSION,
  normalizeHeadlessWarnings,
  type HeadlessWarning,
} from './protocol-metadata.js';

type OutputTimestamp = string;

export interface StreamJsonEnvelope {
  uuid: string;
  session_id: string;
  protocol_version: number;
  event_seq?: number;
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
  eventSeq?: number;
}): StreamJsonEnvelope {
  return dropUndefined({
    uuid: params.uuid,
    session_id: params.sessionId,
    protocol_version: HEADLESS_NATIVE_STREAM_PROTOCOL_VERSION,
    event_seq: params.eventSeq,
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
  eventSeq?: number;
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
    eventSeq: params.eventSeq,
  });
}

export function encodeStreamEvent(params: {
  uuid: string;
  sessionId: string;
  at: Date;
  event: Record<string, unknown>;
  parentToolUseId?: string | null;
  eventSeq?: number;
}): StreamJsonEnvelope {
  return encodeEnvelope({
    uuid: params.uuid,
    sessionId: params.sessionId,
    parentToolUseId: params.parentToolUseId,
    event: dropUndefined({
      ...params.event,
      timestamp: toIso(params.at),
    }) as any,
    eventSeq: params.eventSeq,
  });
}

export function encodeStreamLoopEvent(params: {
  uuid: string;
  sessionId: string;
  event: LoopEvent;
  eventSeq?: number;
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
    eventSeq: params.eventSeq,
  });
}

export function encodeStreamResult(params: {
  uuid: string;
  sessionId: string;
  loopResult: LoopResult;
  at: Date;
  resultText?: string;
  warnings?: readonly HeadlessWarning[];
  eventSeq?: number;
}): StreamJsonEnvelope {
  const exitCode = getStreamExitCode(params.loopResult);
  const warnings = normalizeHeadlessWarnings(params.warnings);
  const safeHint = params.loopResult.safeHint ?? params.loopResult.reason;
  const patchArtifact = params.loopResult.benchmarkPatchArtifact
    ? {
        kind: params.loopResult.benchmarkPatchArtifact.kind,
        path: params.loopResult.benchmarkPatchArtifact.path,
        sha256: params.loopResult.benchmarkPatchArtifact.sha256,
        bytes: params.loopResult.benchmarkPatchArtifact.bytes,
        changed_files: params.loopResult.benchmarkPatchArtifact.changedFiles,
        is_empty: params.loopResult.benchmarkPatchArtifact.isEmpty,
      }
    : undefined;
  const benchmarkArtifact = params.loopResult.benchmarkArtifact
    ? {
        provider: params.loopResult.benchmarkArtifact.provider,
        instance_id: params.loopResult.benchmarkArtifact.instanceId,
        model_name_or_path: params.loopResult.benchmarkArtifact.modelNameOrPath,
        predictions_path: params.loopResult.benchmarkArtifact.predictionsPath,
      }
    : undefined;
  return encodeEnvelope({
    uuid: params.uuid,
    sessionId: params.sessionId,
    event: dropUndefined({
      type: 'result',
      timestamp: toIso(params.at),
      success: Boolean(params.loopResult.success),
      exit_code: exitCode,
      reason: params.loopResult.reason,
      reason_code: params.loopResult.reasonCode,
      diagnostic_code: params.loopResult.diagnosticCode ?? params.loopResult.reasonCode,
      safe_hint: safeHint,
      remediation_steps: params.loopResult.remediationSteps ?? [],
      attempts: params.loopResult.attempts,
      changed_files: params.loopResult.changedFiles ?? [],
      patch_artifact: patchArtifact,
      benchmark_artifact: benchmarkArtifact,
      audit_path: params.loopResult.auditPath,
      error_code: params.loopResult.errorCode,
      authorization_summary: params.loopResult.authorizationSummary,
      result: params.resultText,
      warnings,
      run_end: {
        success: Boolean(params.loopResult.success),
        exit_code: exitCode,
        timestamp: toIso(params.at),
      },
    }) as any,
    eventSeq: params.eventSeq,
  });
}

export function encodeStreamFailure(params: {
  uuid: string;
  sessionId: string;
  at: Date;
  message: string;
  name?: string;
  stack?: string;
  auditPath?: string;
  eventSeq?: number;
}): StreamJsonEnvelope {
  return encodeEnvelope({
    uuid: params.uuid,
    sessionId: params.sessionId,
    event: {
      type: 'error',
      timestamp: toIso(params.at),
      audit_path: params.auditPath,
      error: dropUndefined({
        name: params.name,
        message: params.message,
        stack: params.stack,
      }) as any,
    },
    eventSeq: params.eventSeq,
  });
}

export function encodeStreamCrash(params: {
  uuid: string;
  sessionId: string;
  at: Date;
  error: Error;
  eventSeq?: number;
}): StreamJsonEnvelope {
  return encodeStreamFailure({
    uuid: params.uuid,
    sessionId: params.sessionId,
    at: params.at,
    message: params.error.message,
    name: params.error.name,
    stack: params.error.stack,
    eventSeq: params.eventSeq,
  });
}

export function encodeStreamEnd(params: {
  uuid: string;
  sessionId: string;
  at: Date;
  success: boolean;
  exitCode: number;
  eventSeq?: number;
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
    eventSeq: params.eventSeq,
  });
}
