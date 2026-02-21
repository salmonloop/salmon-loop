import { randomUUID } from 'crypto';

import type { LoopEvent, LoopResult } from '../../core/types/index.js';

import type { SalmonReporter } from './base.js';

export interface JsonPayloadOverrides {
  success?: boolean;
  exitCode?: number;
  reason?: string;
  reasonCode?: string;
  errorCode?: string;
  structuredOutputError?: string;
}

export interface JsonReporterOptions {
  mode?: 'run' | 'chat';
  repoPath?: string;
  sessionId?: string;
  getStructuredOutput?: () => unknown | null;
  getPayloadOverrides?: () => JsonPayloadOverrides | undefined;
  now?: () => Date;
  write?: (chunk: string) => boolean;
}

function toExitCode(result: Partial<LoopResult>): number {
  if (result.reason === 'Operation cancelled by user') return 130;
  return result.success ? 0 : 1;
}

export class JsonReporter implements SalmonReporter {
  private readonly mode: 'run' | 'chat';
  private readonly repoPath?: string;
  private readonly sessionId: string;
  private readonly getStructuredOutput?: () => unknown | null;
  private readonly getPayloadOverrides?: () => JsonPayloadOverrides | undefined;
  private readonly now: () => Date;
  private readonly write: (chunk: string) => boolean;
  private startedAt: Date | null = null;
  private instruction: string | undefined;
  private lastTextResult: string | undefined;

  constructor(options: JsonReporterOptions = {}) {
    this.mode = options.mode ?? 'run';
    this.repoPath = options.repoPath;
    this.sessionId = options.sessionId ?? randomUUID();
    this.getStructuredOutput = options.getStructuredOutput;
    this.getPayloadOverrides = options.getPayloadOverrides;
    this.now = options.now ?? (() => new Date());
    this.write = options.write ?? ((chunk) => process.stdout.write(chunk));
  }

  onStart(instruction: string): void {
    this.startedAt = this.now();
    this.instruction = instruction;
  }

  onEvent(event: LoopEvent): void {
    if (
      event.type === 'llm.output' &&
      event.kind === 'assistant_message' &&
      event.step === 'REPORT'
    ) {
      this.lastTextResult = event.content;
    }
  }

  onFinish(result: LoopResult): void {
    const endedAt = this.now();
    const startedAt = this.startedAt ?? endedAt;
    const overrides = this.getPayloadOverrides?.();
    const exitCode = overrides?.exitCode ?? toExitCode(result);
    const success = overrides?.success ?? Boolean(result.success);
    const reason = overrides?.reason ?? result.reason;
    const reasonCode = overrides?.reasonCode ?? result.reasonCode;
    const errorCode = overrides?.errorCode ?? result.errorCode;

    const structuredOutput = this.getStructuredOutput?.() ?? null;
    const payload = {
      result: this.lastTextResult ?? '',
      structured_output: structuredOutput,
      session_id: this.sessionId,
      metadata: {
        command: this.mode,
        repo_path: this.repoPath,
        instruction: this.instruction,
        success,
        exit_code: exitCode,
        reason,
        reason_code: reasonCode,
        attempts: result.attempts,
        changed_files: result.changedFiles ?? [],
        audit_path: result.auditPath,
        error_code: errorCode,
        authorization_summary: result.authorizationSummary,
        structured_output_error: overrides?.structuredOutputError,
        timestamps: {
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
        },
      },
    };

    this.write(JSON.stringify(payload) + '\n');
  }

  onError(error: Error): void {
    const endedAt = this.now();
    const startedAt = this.startedAt ?? endedAt;

    const payload = {
      result: '',
      structured_output: null as null,
      session_id: this.sessionId,
      metadata: {
        command: this.mode,
        repo_path: this.repoPath,
        instruction: this.instruction,
        success: false,
        exit_code: 1,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        timestamps: {
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
        },
      },
    };

    this.write(JSON.stringify(payload) + '\n');
  }
}
