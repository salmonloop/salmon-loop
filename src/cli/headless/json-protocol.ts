import type { LoopResult } from '../../core/types/index.js';

export interface JsonPayloadOverrides {
  success?: boolean;
  exitCode?: number;
  reason?: string;
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
}

export interface EncodeJsonFailureParams {
  mode: 'run' | 'chat';
  repoPath?: string;
  sessionId: string;
  instruction?: string;
  message: string;
  errorCode?: string;
  exitCode?: number;
  at?: Date;
}

export interface EncodeJsonCrashParams {
  mode: 'run' | 'chat';
  repoPath?: string;
  sessionId: string;
  instruction?: string;
  startedAt: Date;
  endedAt: Date;
  error: Error;
}

function toExitCode(result: Partial<LoopResult>): number {
  if (result.reason === 'Operation cancelled by user') return 130;
  return result.success ? 0 : 1;
}

export function encodeJsonResult(params: EncodeJsonResultParams): unknown {
  const overrides = params.overrides;
  const exitCode = overrides?.exitCode ?? toExitCode(params.loopResult);
  const success = overrides?.success ?? Boolean(params.loopResult.success);
  const reason = overrides?.reason ?? params.loopResult.reason;
  const reasonCode = overrides?.reasonCode ?? params.loopResult.reasonCode;
  const errorCode = overrides?.errorCode ?? params.loopResult.errorCode;

  return {
    result: params.resultText,
    structured_output: params.structuredOutput,
    session_id: params.sessionId,
    metadata: {
      command: params.mode,
      repo_path: params.repoPath,
      instruction: params.instruction,
      success,
      exit_code: exitCode,
      reason,
      reason_code: reasonCode,
      attempts: params.loopResult.attempts,
      changed_files: params.loopResult.changedFiles ?? [],
      audit_path: params.loopResult.auditPath,
      error_code: errorCode,
      authorization_summary: params.loopResult.authorizationSummary,
      structured_output_error: overrides?.structuredOutputError,
      timestamps: {
        started_at: params.startedAt.toISOString(),
        ended_at: params.endedAt.toISOString(),
      },
    },
  };
}

export function encodeJsonFailure(params: EncodeJsonFailureParams): unknown {
  const at = params.at ?? new Date();
  const exitCode = params.exitCode ?? 1;

  return {
    result: '',
    structured_output: null,
    session_id: params.sessionId,
    metadata: {
      command: params.mode,
      repo_path: params.repoPath,
      instruction: params.instruction,
      success: false,
      exit_code: exitCode,
      reason: params.message,
      error_code: params.errorCode,
      timestamps: {
        started_at: at.toISOString(),
        ended_at: at.toISOString(),
      },
    },
  };
}

export function encodeJsonCrash(params: EncodeJsonCrashParams): unknown {
  return {
    result: '',
    structured_output: null as null,
    session_id: params.sessionId,
    metadata: {
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
      timestamps: {
        started_at: params.startedAt.toISOString(),
        ended_at: params.endedAt.toISOString(),
      },
    },
  };
}
