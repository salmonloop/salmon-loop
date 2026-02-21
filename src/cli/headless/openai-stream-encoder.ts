import { randomUUID } from 'crypto';

import type {
  Response,
  ResponseError,
  ResponseFunctionToolCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponseStatus,
  ResponseStreamEvent,
  ToolChoiceOptions,
} from 'openai/resources/responses/responses';

import type { NormalizedStreamEvent } from '../../core/streaming/normalized-events.js';

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

type TextItemState = {
  outputIndex: number;
  itemId: string;
  contentIndex: number;
  text: string;
  contentStarted: boolean;
  done: boolean;
};

type FunctionCallState = {
  outputIndex: number;
  itemId: string;
  name: string;
  args: string;
  done: boolean;
};

export class OpenAiStreamEncoder {
  private readonly now: () => Date;
  private readonly model: string;
  private readonly responseIdFn: () => string;
  private readonly itemIdFn: () => string;
  private readonly metadata: Record<string, string> | null;

  private sequenceNumber = 0;
  private responseId: string | null = null;
  private createdAt: number | null = null;

  private readonly output: ResponseOutputItem[] = [];
  private readonly textItems = new Map<string, TextItemState>();
  private readonly functionCalls = new Map<string, FunctionCallState>();

  constructor(options: OpenAiStreamEncoderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.model = options.model ?? 'unknown';
    this.responseIdFn = options.responseId ?? defaultResponseId;
    this.itemIdFn = options.itemId ?? defaultItemId;
    this.metadata = options.metadata ?? null;
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

  push(event: NormalizedStreamEvent): ResponseStreamEvent[] {
    if (!this.responseId || this.createdAt === null) return [];

    if (event.type === 'normalized.message_start') {
      if (event.role !== 'assistant' || event.source !== 'llm') return [];

      const outputIndex = this.output.length;
      const itemId = this.itemIdFn();
      const item: ResponseOutputMessage = {
        id: itemId,
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: [],
      };

      this.output.push(item);
      this.textItems.set(event.messageId, {
        outputIndex,
        itemId,
        contentIndex: 0,
        text: '',
        contentStarted: false,
        done: false,
      });

      return [
        {
          type: 'response.output_item.added',
          sequence_number: this.nextSequenceNumber(),
          output_index: outputIndex,
          item,
        },
      ];
    }

    if (event.type === 'normalized.content_block_start') {
      if (event.blockType !== 'text') return [];

      const st = this.textItems.get(event.messageId);
      if (!st || st.done) return [];
      if (st.contentStarted) return [];
      st.contentStarted = true;

      const item = this.output[st.outputIndex];
      if (!item || item.type !== 'message') return [];

      const part: ResponseOutputText = { type: 'output_text', text: '', annotations: [] };
      item.content.push(part);

      return [
        {
          type: 'response.content_part.added',
          sequence_number: this.nextSequenceNumber(),
          output_index: st.outputIndex,
          item_id: st.itemId,
          content_index: st.contentIndex,
          part,
        },
      ];
    }

    if (event.type === 'normalized.content_block_delta') {
      if (event.deltaType !== 'text') return [];

      const st = this.textItems.get(event.messageId);
      if (!st || st.done) return [];
      st.text += event.text;

      return [
        {
          type: 'response.output_text.delta',
          sequence_number: this.nextSequenceNumber(),
          output_index: st.outputIndex,
          item_id: st.itemId,
          content_index: st.contentIndex,
          delta: event.text,
          logprobs: [],
        },
      ];
    }

    if (event.type === 'normalized.content_block_end') {
      const st = this.textItems.get(event.messageId);
      if (!st || st.done) return [];

      const item = this.output[st.outputIndex];
      if (!item || item.type !== 'message') return [];

      const part: ResponseOutputText = {
        type: 'output_text',
        text: st.text,
        annotations: [],
      };

      if (item.content.length === 0) item.content.push(part);
      else item.content[0] = part;

      return [
        {
          type: 'response.output_text.done',
          sequence_number: this.nextSequenceNumber(),
          output_index: st.outputIndex,
          item_id: st.itemId,
          content_index: st.contentIndex,
          text: st.text,
          logprobs: [],
        },
        {
          type: 'response.content_part.done',
          sequence_number: this.nextSequenceNumber(),
          output_index: st.outputIndex,
          item_id: st.itemId,
          content_index: st.contentIndex,
          part,
        },
      ];
    }

    if (event.type === 'normalized.message_end') {
      const st = this.textItems.get(event.messageId);
      if (!st || st.done) return [];
      st.done = true;

      const item = this.output[st.outputIndex];
      if (!item || item.type !== 'message') return [];
      item.status = 'completed';

      return [
        {
          type: 'response.output_item.done',
          sequence_number: this.nextSequenceNumber(),
          output_index: st.outputIndex,
          item,
        },
      ];
    }

    if (event.type === 'normalized.tool_call_start') {
      if (this.functionCalls.has(event.callId)) return [];

      const outputIndex = this.output.length;
      const itemId = this.itemIdFn();

      const item: ResponseFunctionToolCall = {
        id: itemId,
        type: 'function_call',
        call_id: event.callId,
        name: event.toolName,
        arguments: '',
        status: 'in_progress',
      };

      this.output.push(item);
      this.functionCalls.set(event.callId, {
        outputIndex,
        itemId,
        name: event.toolName,
        args: '{}',
        done: false,
      });

      return [
        {
          type: 'response.output_item.added',
          sequence_number: this.nextSequenceNumber(),
          output_index: outputIndex,
          item,
        },
        {
          type: 'response.function_call_arguments.delta',
          sequence_number: this.nextSequenceNumber(),
          output_index: outputIndex,
          item_id: itemId,
          delta: '{}',
        },
        {
          type: 'response.function_call_arguments.done',
          sequence_number: this.nextSequenceNumber(),
          output_index: outputIndex,
          item_id: itemId,
          name: event.toolName,
          arguments: '{}',
        },
      ];
    }

    if (event.type === 'normalized.tool_call_end') {
      const st = this.functionCalls.get(event.callId);
      if (!st || st.done) return [];
      st.done = true;

      const item = this.output[st.outputIndex];
      if (!item || item.type !== 'function_call') return [];
      item.arguments = st.args;
      item.status = 'completed';

      return [
        {
          type: 'response.output_item.done',
          sequence_number: this.nextSequenceNumber(),
          output_index: st.outputIndex,
          item,
        },
      ];
    }

    return [];
  }

  complete(params: { ok: boolean; message?: string; code?: string | null }): ResponseStreamEvent[] {
    if (!this.responseId || this.createdAt === null) return [];

    const outputText = this.collectOutputText();
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
      output: this.output,
      error,
      metadata: this.metadata,
      completedAt: params.ok ? completedAt : undefined,
    });

    return [
      {
        type: params.ok ? 'response.completed' : 'response.failed',
        sequence_number: this.nextSequenceNumber(),
        response,
      },
    ];
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

  private nextSequenceNumber(): number {
    return this.sequenceNumber++;
  }

  private collectOutputText(): string {
    const parts: string[] = [];
    for (const item of this.output) {
      if (item.type !== 'message') continue;
      for (const part of item.content) {
        if (part.type === 'output_text' && part.text) parts.push(part.text);
      }
    }
    return parts.join('');
  }
}
