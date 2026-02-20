import { randomUUID } from 'crypto';

import type { LoopEvent, LoopResult } from '../../core/types/index.js';

import type { SalmonReporter } from './base.js';

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

export interface StreamJsonReporterOptions {
  mode?: 'run' | 'chat';
  repoPath?: string;
  sessionId?: string;
  now?: () => Date;
  write?: (chunk: string) => boolean;
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

function toExitCode(result: Partial<LoopResult>): number {
  if (result.reason === 'Operation cancelled by user') return 130;
  return result.success ? 0 : 1;
}

export class StreamJsonReporter implements SalmonReporter {
  private readonly mode: 'run' | 'chat';
  private readonly repoPath?: string;
  private readonly sessionId: string;
  private readonly now: () => Date;
  private readonly write: (chunk: string) => boolean;
  private lastTextResult: string | undefined;

  constructor(options: StreamJsonReporterOptions = {}) {
    this.mode = options.mode ?? 'run';
    this.repoPath = options.repoPath;
    this.sessionId = options.sessionId ?? randomUUID();
    this.now = options.now ?? (() => new Date());
    this.write = options.write ?? ((chunk) => process.stdout.write(chunk));
  }

  onStart(instruction: string): void {
    const line: StreamJsonLine = dropUndefined({
      type: 'start',
      session_id: this.sessionId,
      timestamp: toIso(this.now()),
      command: this.mode,
      repo_path: this.repoPath,
      instruction,
    }) as any;
    this.emit(line);
  }

  onEvent(event: LoopEvent): void {
    if (
      event.type === 'llm.output' &&
      event.kind === 'assistant_message' &&
      event.step === 'REPORT'
    ) {
      this.lastTextResult = event.content;
    }

    if (event.type === 'llm.stream.delta') {
      const line: StreamJsonLine = {
        type: 'stream_event',
        session_id: this.sessionId,
        timestamp: toIso(event.timestamp),
        event: dropUndefined({
          kind: event.kind,
          step: event.step,
          stream_id: event.streamId,
          delta: {
            type: 'text_delta',
            text: event.content,
          },
        }),
      };
      this.emit(line);
      return;
    }

    if (event.type === 'llm.stream.end') {
      const line: StreamJsonLine = {
        type: 'stream_event',
        session_id: this.sessionId,
        timestamp: toIso(event.timestamp),
        event: dropUndefined({
          kind: event.kind,
          step: event.step,
          stream_id: event.streamId,
          finish_reason: event.finishReason,
        }),
      };
      this.emit(line);
      return;
    }

    const line: StreamJsonLine = {
      type: 'loop_event',
      session_id: this.sessionId,
      timestamp: toIso(event.timestamp),
      event: mapLoopEventToJson(event),
    };
    this.emit(line);
  }

  onFinish(result: LoopResult): void {
    const timestamp = toIso(this.now());

    if (result.authorizationSummary) {
      const summaryLine: StreamJsonLine = {
        type: 'loop_event',
        session_id: this.sessionId,
        timestamp,
        event: {
          type: 'authorization.summary',
          stage: 'final',
          summary: result.authorizationSummary,
        },
      };
      this.emit(summaryLine);
    }

    const exitCode = toExitCode(result);
    const line: StreamJsonLine = dropUndefined({
      type: 'result',
      session_id: this.sessionId,
      timestamp,
      success: Boolean(result.success),
      exit_code: exitCode,
      reason: result.reason,
      reason_code: result.reasonCode,
      attempts: result.attempts,
      changed_files: result.changedFiles,
      audit_path: result.auditPath,
      error_code: result.errorCode,
      authorization_summary: result.authorizationSummary,
      result: this.lastTextResult,
    }) as any;
    this.emit(line);

    const endLine: StreamJsonLine = {
      type: 'end',
      session_id: this.sessionId,
      timestamp: toIso(this.now()),
      success: Boolean(result.success),
      exit_code: exitCode,
    };
    this.emit(endLine);
  }

  onError(error: Error): void {
    const line: StreamJsonLine = {
      type: 'error',
      session_id: this.sessionId,
      timestamp: toIso(this.now()),
      error: dropUndefined({
        name: error.name,
        message: error.message,
        stack: error.stack,
      }) as any,
    };
    this.emit(line);
  }

  private emit(line: StreamJsonLine): void {
    this.write(JSON.stringify(line) + '\n');
  }
}
