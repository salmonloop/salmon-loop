import { randomUUID } from 'crypto';

import type { LoopEvent, LoopResult } from '../../core/types/index.js';
import type { JsonPayloadOverrides } from '../headless/json-protocol.js';
import { encodeJsonCrash, encodeJsonResult } from '../headless/json-protocol.js';

import type { SalmonReporter } from './base.js';

export interface JsonReporterOptions {
  mode?: 'run' | 'chat';
  repoPath?: string;
  sessionId?: string;
  getStructuredOutput?: () => unknown | null;
  getPayloadOverrides?: () => JsonPayloadOverrides | undefined;
  now?: () => Date;
  write?: (chunk: string) => boolean;
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

    const structuredOutput = this.getStructuredOutput?.() ?? null;
    const payload = encodeJsonResult({
      mode: this.mode,
      repoPath: this.repoPath,
      sessionId: this.sessionId,
      instruction: this.instruction,
      startedAt,
      endedAt,
      resultText: this.lastTextResult ?? '',
      structuredOutput,
      loopResult: result,
      overrides,
    });

    this.write(JSON.stringify(payload) + '\n');
  }

  onError(error: Error): void {
    const endedAt = this.now();
    const startedAt = this.startedAt ?? endedAt;
    const payload = encodeJsonCrash({
      mode: this.mode,
      repoPath: this.repoPath,
      sessionId: this.sessionId,
      instruction: this.instruction,
      startedAt,
      endedAt,
      error,
    });

    this.write(JSON.stringify(payload) + '\n');
  }
}
