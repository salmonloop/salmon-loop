import { randomUUID } from 'crypto';

import type { NormalizedStreamEvent } from '../../core/streaming/normalized-events.js';

type OpenAiStreamEvent = Record<string, unknown>;

type OpenAiErrorObject = {
  message: string;
  type: string;
  param: string | null;
  code: string | null;
};

type OpenAiResponseError = {
  message: string;
  type: string;
  param: string | null;
  code: string | null;
};

type OpenAiResponseTextPart = {
  type: 'output_text';
  text: string;
  annotations: unknown[];
};

type OpenAiFunctionCallOutputItem = {
  id: string;
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  status: 'in_progress' | 'completed';
};

type OpenAiMessageOutputItem = {
  id: string;
  type: 'message';
  status: 'in_progress' | 'completed';
  role: 'assistant';
  content: OpenAiResponseTextPart[];
};

type OpenAiOutputItem = OpenAiMessageOutputItem | OpenAiFunctionCallOutputItem;

type OpenAiResponseObject = {
  id: string;
  object: 'response';
  created_at: number;
  user: string | null;
  status: 'in_progress' | 'completed' | 'failed';
  error: OpenAiResponseError | null;
  incomplete_details: null;
  instructions: string | null;
  max_output_tokens: number | null;
  model: string;
  output: OpenAiOutputItem[];
  parallel_tool_calls: boolean;
  previous_response_id: string | null;
  reasoning: { effort: string | null; summary: string | null };
  store: boolean;
  temperature: number;
  text: { format: { type: 'text' } };
  tool_choice: 'auto';
  tools: unknown[];
  top_p: number;
  truncation: 'disabled';
  usage: null;
  metadata: Record<string, string>;
  completed_at?: number | null;
};

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function createResponseObject(params: {
  id: string;
  createdAt: number;
  status: OpenAiResponseObject['status'];
  model: string;
  output: OpenAiOutputItem[];
  error: OpenAiResponseError | null;
  metadata?: Record<string, string>;
  completedAt?: number;
}): OpenAiResponseObject {
  const response: OpenAiResponseObject = {
    id: params.id,
    object: 'response',
    created_at: params.createdAt,
    user: null,
    status: params.status,
    error: params.error,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: params.model,
    output: params.output,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: true,
    temperature: 1,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    truncation: 'disabled',
    usage: null,
    metadata: params.metadata ?? {},
  };

  if (typeof params.completedAt === 'number') response.completed_at = params.completedAt;
  return response;
}

function defaultResponseId(): string {
  return `resp_${randomUUID().replace(/-/g, '')}`;
}

function defaultItemId(): string {
  return `msg_${randomUUID().replace(/-/g, '')}`;
}

function defaultFunctionCallId(): string {
  return `fc_${randomUUID().replace(/-/g, '')}`;
}

function createErrorObject(params: {
  message: string;
  type: string;
  code?: string | null;
}): OpenAiErrorObject {
  return {
    message: params.message,
    type: params.type,
    param: null,
    code: params.code ?? null,
  };
}

function createResponseError(params: {
  message: string;
  type: string;
  code?: string | null;
}): OpenAiResponseError {
  return {
    message: params.message,
    type: params.type,
    param: null,
    code: params.code ?? null,
  };
}

export interface OpenAiStreamEncoderOptions {
  now?: () => Date;
  model?: string;
  responseId?: () => string;
  itemId?: () => string;
  functionCallId?: () => string;
  metadata?: Record<string, string>;
}

export class OpenAiStreamEncoder {
  private readonly now: () => Date;
  private readonly model: string;
  private readonly responseIdFn: () => string;
  private readonly itemIdFn: () => string;
  private readonly functionCallIdFn: () => string;
  private readonly metadata: Record<string, string>;

  private responseId: string | null = null;
  private createdAt: number | null = null;
  private readonly output: OpenAiOutputItem[] = [];
  private readonly byMessageId = new Map<
    string,
    { outputIndex: number; itemId: string; text: string; contentStarted: boolean }
  >();
  private readonly byCallId = new Map<string, { outputIndex: number; itemId: string }>();

  constructor(options: OpenAiStreamEncoderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.model = options.model ?? 'unknown';
    this.responseIdFn = options.responseId ?? defaultResponseId;
    this.itemIdFn = options.itemId ?? defaultItemId;
    this.functionCallIdFn = options.functionCallId ?? defaultFunctionCallId;
    this.metadata = options.metadata ?? {};
  }

  start(): OpenAiStreamEvent[] {
    if (this.responseId) return [];

    const at = this.now();
    this.responseId = this.responseIdFn();
    this.createdAt = toEpochSeconds(at);

    const response = createResponseObject({
      id: this.responseId,
      createdAt: this.createdAt,
      status: 'in_progress',
      model: this.model,
      output: this.output,
      error: null,
      metadata: this.metadata,
    });

    return [
      {
        type: 'response.created',
        response,
      },
      {
        type: 'response.in_progress',
        response,
      },
    ];
  }

  push(event: NormalizedStreamEvent): OpenAiStreamEvent[] {
    if (!this.responseId || this.createdAt === null) return [];

    if (event.type === 'normalized.message_start') {
      if (event.role !== 'assistant' || event.source !== 'llm') return [];

      const outputIndex = this.output.length;
      const itemId = this.itemIdFn();
      const item: OpenAiMessageOutputItem = {
        id: itemId,
        type: 'message',
        status: 'in_progress',
        role: 'assistant',
        content: [],
      };
      this.output.push(item);
      this.byMessageId.set(event.messageId, {
        outputIndex,
        itemId,
        text: '',
        contentStarted: false,
      });

      return [
        {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item,
        },
      ];
    }

    if (event.type === 'normalized.content_block_start') {
      if (event.blockType !== 'text') return [];

      const st = this.byMessageId.get(event.messageId);
      if (!st) return [];
      if (st.contentStarted) return [];
      st.contentStarted = true;

      const item = this.output[st.outputIndex];
      if (!item || item.type !== 'message') return [];
      const part: OpenAiResponseTextPart = { type: 'output_text', text: '', annotations: [] };
      item.content.push(part);

      return [
        {
          type: 'response.content_part.added',
          output_index: st.outputIndex,
          item_id: st.itemId,
          content_index: 0,
          part,
        },
      ];
    }

    if (event.type === 'normalized.content_block_delta') {
      if (event.deltaType !== 'text') return [];

      const st = this.byMessageId.get(event.messageId);
      if (!st) return [];

      st.text += event.text;

      return [
        {
          type: 'response.output_text.delta',
          output_index: st.outputIndex,
          item_id: st.itemId,
          content_index: 0,
          delta: event.text,
        },
      ];
    }

    if (event.type === 'normalized.content_block_end') {
      const st = this.byMessageId.get(event.messageId);
      if (!st) return [];

      const item = this.output[st.outputIndex];
      if (!item || item.type !== 'message') return [];
      const part: OpenAiResponseTextPart = {
        type: 'output_text',
        text: st.text,
        annotations: [],
      };
      if (item.content.length === 0) item.content.push(part);
      else item.content[0] = part;

      return [
        {
          type: 'response.output_text.done',
          output_index: st.outputIndex,
          item_id: st.itemId,
          content_index: 0,
          text: st.text,
        },
        {
          type: 'response.content_part.done',
          output_index: st.outputIndex,
          item_id: st.itemId,
          content_index: 0,
          part,
        },
      ];
    }

    if (event.type === 'normalized.message_end') {
      const st = this.byMessageId.get(event.messageId);
      if (!st) return [];

      const item = this.output[st.outputIndex];
      item.status = 'completed';

      return [
        {
          type: 'response.output_item.done',
          output_index: st.outputIndex,
          item,
        },
      ];
    }

    if (event.type === 'normalized.tool_call_start') {
      if (this.byCallId.has(event.callId)) return [];

      const outputIndex = this.output.length;
      const itemId = this.functionCallIdFn();
      const item: OpenAiFunctionCallOutputItem = {
        id: itemId,
        type: 'function_call',
        call_id: event.callId,
        name: event.toolName,
        arguments: '{}',
        status: 'in_progress',
      };

      this.output.push(item);
      this.byCallId.set(event.callId, { outputIndex, itemId });

      return [
        {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item,
        },
      ];
    }

    if (event.type === 'normalized.tool_call_end') {
      const existing = this.byCallId.get(event.callId);
      if (!existing) {
        const startLines = this.push({
          type: 'normalized.tool_call_start',
          callId: event.callId,
          toolName: event.toolName,
          phase: event.phase,
          round: event.round,
          timestamp: event.timestamp,
        } as any);
        return [...startLines, ...this.push(event)];
      }

      const item = this.output[existing.outputIndex] as OpenAiFunctionCallOutputItem;
      item.status = 'completed';

      return [
        {
          type: 'response.output_item.done',
          output_index: existing.outputIndex,
          item,
        },
      ];
    }

    return [];
  }

  complete(params: { ok: boolean; message?: string; code?: string | null }): OpenAiStreamEvent[] {
    if (!this.responseId || this.createdAt === null) return [];

    for (const item of this.output) item.status = 'completed';

    const completedAt = toEpochSeconds(this.now());
    const error = params.ok
      ? null
      : createResponseError({
          message: params.message ?? 'Unknown error',
          type: 'server_error',
          code: params.code ?? null,
        });

    const response = createResponseObject({
      id: this.responseId,
      createdAt: this.createdAt,
      status: params.ok ? 'completed' : 'failed',
      model: this.model,
      output: this.output,
      error,
      metadata: this.metadata,
      completedAt,
    });

    return [
      {
        type: params.ok ? 'response.completed' : 'response.failed',
        response,
      },
    ];
  }

  crash(error: Error): OpenAiStreamEvent[] {
    if (!this.responseId || this.createdAt === null) {
      const message = error.message || 'Unexpected error';
      return [
        {
          type: 'error',
          error: createErrorObject({ message, type: 'server_error' }),
        },
      ];
    }

    const message = error.message || 'Unexpected error';
    return [
      {
        type: 'error',
        error: createErrorObject({ message, type: 'server_error' }),
      },
      ...this.complete({ ok: false, message, code: null }),
    ];
  }

  usageError(params: { message: string; code?: string | null }): OpenAiStreamEvent[] {
    const events: OpenAiStreamEvent[] = [];
    events.push(...this.start());
    events.push({
      type: 'error',
      error: createErrorObject({
        message: params.message,
        type: 'invalid_request_error',
        code: params.code ?? 'usage_error',
      }),
    });
    events.push(
      ...this.complete({ ok: false, message: params.message, code: params.code ?? null }),
    );
    return events;
  }
}
