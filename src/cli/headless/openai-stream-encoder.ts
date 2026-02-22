import { randomUUID } from 'crypto';

import type {
  Response,
  ResponseError,
  ResponseOutputItem,
  ResponseStatus,
  ResponseStreamEvent,
  ToolChoiceOptions,
} from 'openai/resources/responses/responses';

import type { CanonicalResponsesEvent } from '../../core/streaming/canonical/responses-events.js';
import type { NormalizedStreamEvent } from '../../core/streaming/normalized-events.js';

import {
  OpenAiResponsesState,
  type UnsequencedResponseStreamEvent,
} from './openai-responses-state.js';

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function defaultResponseId(): string {
  return `resp_${randomUUID().replace(/-/g, '')}`;
}

function defaultItemId(): string {
  return `item_${randomUUID().replace(/-/g, '')}`;
}

function createResponseObject(params: {
  id: string;
  createdAt: number;
  status: ResponseStatus;
  model: string;
  outputText: string;
  output: ResponseOutputItem[];
  error: ResponseError | null;
  metadata: Record<string, string> | null;
  completedAt?: number;
}): Response {
  const response: Response = {
    id: params.id,
    object: 'response',
    created_at: params.createdAt,
    output_text: params.outputText,
    error: params.error,
    incomplete_details: null,
    instructions: null,
    metadata: params.metadata,
    model: params.model,
    output: params.output,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: 'auto' satisfies ToolChoiceOptions,
    tools: [],
    top_p: null,
    status: params.status,
  };

  if (typeof params.completedAt === 'number') response.completed_at = params.completedAt;
  return response;
}

function createResponseError(params: {
  message: string;
  code: ResponseError['code'];
}): ResponseError {
  return { code: params.code, message: params.message };
}

export interface OpenAiStreamEncoderOptions {
  now?: () => Date;
  model?: string;
  responseId?: () => string;
  itemId?: () => string;
  metadata?: Record<string, string> | null;
}

export class OpenAiStreamEncoder {
  private readonly now: () => Date;
  private readonly model: string;
  private readonly responseIdFn: () => string;
  private readonly metadata: Record<string, string> | null;

  private sequenceNumber = 0;
  private responseId: string | null = null;
  private createdAt: number | null = null;

  private readonly state: OpenAiResponsesState;

  constructor(options: OpenAiStreamEncoderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.model = options.model ?? 'unknown';
    this.responseIdFn = options.responseId ?? defaultResponseId;
    this.metadata = options.metadata ?? null;
    this.state = new OpenAiResponsesState(options.itemId ?? defaultItemId);
  }

  start(): ResponseStreamEvent[] {
    if (this.responseId) return [];

    const at = this.now();
    this.responseId = this.responseIdFn();
    this.createdAt = toEpochSeconds(at);

    const response = createResponseObject({
      id: this.responseId,
      createdAt: this.createdAt,
      status: 'in_progress',
      model: this.model,
      outputText: '',
      output: [],
      error: null,
      metadata: this.metadata,
    });

    return [
      {
        type: 'response.created',
        sequence_number: this.nextSequenceNumber(),
        response,
      },
      {
        type: 'response.in_progress',
        sequence_number: this.nextSequenceNumber(),
        response,
      },
    ];
  }

  pushResponsesEvent(params: {
    streamId: string;
    event: CanonicalResponsesEvent;
  }): ResponseStreamEvent[] {
    if (!this.responseId || this.createdAt === null) return [];
    return this.sequence(this.state.applyCanonical(params));
  }

  push(event: NormalizedStreamEvent): ResponseStreamEvent[] {
    if (!this.responseId || this.createdAt === null) return [];
    return this.sequence(this.state.applyNormalized(event));
  }

  complete(params: { ok: boolean; message?: string; code?: string | null }): ResponseStreamEvent[] {
    if (!this.responseId || this.createdAt === null) return [];

    const outputText = this.state.collectOutputText();
    const completedAt = toEpochSeconds(this.now());

    const error = params.ok
      ? null
      : createResponseError({
          message: params.message ?? 'Unknown error',
          code: params.code === 'usage_error' ? 'invalid_prompt' : 'server_error',
        });

    const response = createResponseObject({
      id: this.responseId,
      createdAt: this.createdAt,
      status: params.ok ? 'completed' : 'failed',
      model: this.model,
      outputText,
      output: this.state.getOutput(),
      error,
      metadata: this.metadata,
      completedAt: params.ok ? completedAt : undefined,
    });

    return this.sequence([
      { type: params.ok ? 'response.completed' : 'response.failed', response },
    ]);
  }

  crash(error: Error): ResponseStreamEvent[] {
    const message = error.message || 'Unexpected error';
    return [
      ...this.start(),
      {
        type: 'error',
        sequence_number: this.nextSequenceNumber(),
        code: 'server_error',
        message,
        param: null,
      },
      ...this.complete({ ok: false, message, code: null }),
    ];
  }

  usageError(params: { message: string; code?: string | null }): ResponseStreamEvent[] {
    const code = params.code ?? 'usage_error';
    return [
      ...this.start(),
      {
        type: 'error',
        sequence_number: this.nextSequenceNumber(),
        code,
        message: params.message,
        param: null,
      },
      ...this.complete({ ok: false, message: params.message, code }),
    ];
  }

  private sequence(events: UnsequencedResponseStreamEvent[]): ResponseStreamEvent[] {
    return events.map((e) => ({ ...e, sequence_number: this.nextSequenceNumber() }));
  }

  private nextSequenceNumber(): number {
    return this.sequenceNumber++;
  }
}
