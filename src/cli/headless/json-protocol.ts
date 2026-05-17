import type { LoopResult } from '../../core/facades/cli-headless.js';

import {
  HEADLESS_SCHEMA_VERSION,
  normalizeHeadlessWarnings,
  type HeadlessWarning,
} from './protocol-metadata.js';

export interface JsonPayloadOverrides {
  success?: boolean;
  exitCode?: number;
  reason?: string;
  safeHint?: string;
  remediationSteps?: string[];
  diagnosticCode?: string;
  reasonCode?: string;
  errorCode?: string;
  structuredOutputError?: string;
}

export interface EncodeJsonResultParams {
  mode: 'run' | 'chat';
  repoPath?: string;
  sessionId: string;
  instruction?: string;
  startedAt: Date;
  endedAt: Date;
  resultText: string;
  structuredOutput: unknown | null;
  loopResult: LoopResult;
  overrides?: JsonPayloadOverrides;
  warnings?: readonly HeadlessWarning[];
}

export interface EncodeJsonFailureParams {
  mode: 'run' | 'chat';
  repoPath?: string;
  sessionId: string;
  instruction?: string;
  message: string;
  errorCode?: string;
  auditPath?: string;
  exitCode?: number;
  at?: Date;
  warnings?: readonly HeadlessWarning[];
}

export interface EncodeJsonCrashParams {
  mode: 'run' | 'chat';
  repoPath?: string;
  sessionId: string;
  instruction?: string;
  startedAt: Date;
  endedAt: Date;
  error: Error;
  warnings?: readonly HeadlessWarning[];
}

function toExitCode(result: Partial<LoopResult>): number {
  if (result.reason === 'Operation cancelled by user') return 130;
  return result.success ? 0 : 1;
}

function toUsage(
  result: LoopResult,
): { input_tokens: number; output_tokens: number; total_tokens: number } | undefined {
  const usage = result.usage;
  if (!usage) return undefined;
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
  };
}

function toAuthorizationDecisions(result: LoopResult): unknown[] | undefined {
  const decisions = result.authorizationDecisions;
  if (!Array.isArray(decisions) || decisions.length === 0) return undefined;
  return decisions.map((d) => ({
    call_id: d.callId,
    tool_name: d.toolName,
    phase: d.phase,
    outcome: d.outcome,
    source: d.source,
    reason: d.reason,
    ttl_ms: d.ttlMs,
    persist: d.persist,
    risk_level: d.riskLevel,
    side_effects: d.sideEffects,
    timestamp: d.timestamp,
  }));
}

function toPatchArtifact(result: LoopResult): unknown {
  const artifact = result.benchmarkPatchArtifact;
  if (!artifact) return undefined;
  return {
    kind: artifact.kind,
    path: artifact.path,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    changed_files: artifact.changedFiles,
    is_empty: artifact.isEmpty,
  };
}

function toBenchmarkArtifact(result: LoopResult): unknown {
  const artifact = result.benchmarkArtifact;
  if (!artifact) return undefined;
  return {
    provider: artifact.provider,
    instance_id: artifact.instanceId,
    model_name_or_path: artifact.modelNameOrPath,
    predictions_path: artifact.predictionsPath,
  };
}

export function encodeJsonResult(params: EncodeJsonResultParams): unknown {
  const overrides = params.overrides;
  const exitCode = overrides?.exitCode ?? toExitCode(params.loopResult);
  const success = overrides?.success ?? Boolean(params.loopResult.success);
  const safeHint = overrides?.safeHint ?? params.loopResult.safeHint ?? params.loopResult.reason;
  const remediationSteps = overrides?.remediationSteps ?? params.loopResult.remediationSteps ?? [];
  const diagnosticCode =
    overrides?.diagnosticCode ?? params.loopResult.diagnosticCode ?? params.loopResult.reasonCode;
  const reason = overrides?.reason ?? safeHint;
  const reasonCode = overrides?.reasonCode ?? params.loopResult.reasonCode;
  const errorCode = overrides?.errorCode ?? params.loopResult.errorCode;
  const warnings = normalizeHeadlessWarnings(params.warnings);

  return {
    result: params.resultText,
    structured_output: params.structuredOutput,
    session_id: params.sessionId,
    metadata: {
      schema_version: HEADLESS_SCHEMA_VERSION,
      command: params.mode,
      repo_path: params.repoPath,
      instruction: params.instruction,
      success,
      exit_code: exitCode,
      reason,
      reason_code: reasonCode,
      diagnostic_code: diagnosticCode,
      safe_hint: safeHint,
      remediation_steps: remediationSteps,
      attempts: params.loopResult.attempts,
      changed_files: params.loopResult.changedFiles ?? [],
      patch_artifact: toPatchArtifact(params.loopResult),
      benchmark_artifact: toBenchmarkArtifact(params.loopResult),
      audit_path: params.loopResult.auditPath,
      error_code: errorCode,
      authorization_summary: params.loopResult.authorizationSummary,
      usage: toUsage(params.loopResult),
      authorization_decisions: toAuthorizationDecisions(params.loopResult),
      structured_output_error: overrides?.structuredOutputError,
      warnings,
      timestamps: {
        started_at: params.startedAt.toISOString(),
        ended_at: params.endedAt.toISOString(),
      },
      run_end: {
        success,
        exit_code: exitCode,
        timestamp: params.endedAt.toISOString(),
      },
    },
  };
}

export function encodeJsonFailure(params: EncodeJsonFailureParams): unknown {
  const at = params.at ?? new Date();
  const exitCode = params.exitCode ?? 1;
  const warnings = normalizeHeadlessWarnings(params.warnings);

  return {
    result: '',
    structured_output: null,
    session_id: params.sessionId,
    metadata: {
      schema_version: HEADLESS_SCHEMA_VERSION,
      command: params.mode,
      repo_path: params.repoPath,
      instruction: params.instruction,
      success: false,
      exit_code: exitCode,
      reason: params.message,
      error_code: params.errorCode,
      audit_path: params.auditPath,
      warnings,
      timestamps: {
        started_at: at.toISOString(),
        ended_at: at.toISOString(),
      },
    },
  };
}

export function encodeJsonCrash(params: EncodeJsonCrashParams): unknown {
  const warnings = normalizeHeadlessWarnings(params.warnings);

  return {
    result: '',
    structured_output: null as null,
    session_id: params.sessionId,
    metadata: {
      schema_version: HEADLESS_SCHEMA_VERSION,
      command: params.mode,
      repo_path: params.repoPath,
      instruction: params.instruction,
      success: false,
      exit_code: 1,
      error: {
        name: params.error.name,
        message: params.error.message,
        stack: params.error.stack,
      },
      warnings,
      timestamps: {
        started_at: params.startedAt.toISOString(),
        ended_at: params.endedAt.toISOString(),
      },
    },
  };
}
