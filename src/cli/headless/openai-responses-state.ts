import type {
  ResponseFunctionToolCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';

type WithoutSequenceNumber<T> = T extends any ? Omit<T, 'sequence_number'> : never;
export type UnsequencedResponseStreamEvent = WithoutSequenceNumber<ResponseStreamEvent>;

type TextItemState = {
  outputIndex: number;
  itemId: string;
  contentIndex: number;
  text: string;
  contentStarted: boolean;
  outputTextDone: boolean;
  contentPartDone: boolean;
  outputItemDone: boolean;
};

type FunctionCallState = {
  outputIndex: number;
  itemId: string;
  name: string;
  args: string;
  done: boolean;
};

function cloneOutputTextPart(part: ResponseOutputText): ResponseOutputText {
  return {
    ...part,
    annotations: Array.isArray(part.annotations) ? [...part.annotations] : [],
  };
}

function cloneOutputItem(item: ResponseOutputItem): ResponseOutputItem {
  if (item.type === 'message') {
    const message = item as ResponseOutputMessage;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === 'output_text') return cloneOutputTextPart(part as ResponseOutputText);
        return part;
      }),
    };
  }

  if (item.type === 'function_call') {
    return { ...(item as ResponseFunctionToolCall) };
  }

  return item;
}

export class OpenAiResponsesState {
  private readonly output: ResponseOutputItem[] = [];
  private readonly textItems = new Map<string, TextItemState>();
  private readonly functionCalls = new Map<string, FunctionCallState>();

  constructor(private readonly itemIdFn: () => string) {}

  getOutput(): ResponseOutputItem[] {
    return this.output;
  }

  collectOutputText(): string {
    const parts: string[] = [];
    for (const item of this.output) {
      if (item.type !== 'message') continue;
      for (const part of item.content) {
        if (part.type === 'output_text' && part.text) parts.push(part.text);
      }
    }
    return parts.join('');
  }

  hasTextStream(streamId: string): boolean {
    return this.textItems.has(streamId);
  }

  ensureMessage(
    streamId: string,
    params: { role: ResponseOutputMessage['role']; itemId?: string },
  ): UnsequencedResponseStreamEvent[] {
    if (this.textItems.has(streamId)) return [];

    const outputIndex = this.output.length;
    const resolvedItemId = params.itemId ?? this.itemIdFn();
    const message: ResponseOutputMessage = {
      id: resolvedItemId,
      type: 'message',
      role: params.role,
      status: 'in_progress',
      content: [],
    };

    this.output.push(message);
    this.textItems.set(streamId, {
      outputIndex,
      itemId: resolvedItemId,
      contentIndex: 0,
      text: '',
      contentStarted: false,
      outputTextDone: false,
      contentPartDone: false,
      outputItemDone: false,
    });

    return [
      {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: cloneOutputItem(message),
      },
    ];
  }

  ensureAssistantMessage(streamId: string, itemId?: string): UnsequencedResponseStreamEvent[] {
    return this.ensureMessage(streamId, { role: 'assistant', itemId });
  }

  ensureTextPart(streamId: string): UnsequencedResponseStreamEvent[] {
    const out: UnsequencedResponseStreamEvent[] = [];
    if (!this.textItems.has(streamId)) out.push(...this.ensureAssistantMessage(streamId));

    const st = this.textItems.get(streamId);
    if (!st || st.outputItemDone) return out;
    if (st.contentStarted) return out;
    st.contentStarted = true;

    const item = this.output[st.outputIndex];
    if (!item || item.type !== 'message') return out;

    const part: ResponseOutputText = { type: 'output_text', text: '', annotations: [] };
    item.content.push(part);

    out.push({
      type: 'response.content_part.added',
      output_index: st.outputIndex,
      item_id: st.itemId,
      content_index: st.contentIndex,
      part: cloneOutputTextPart(part),
    });

    return out;
  }

  appendTextDelta(streamId: string, delta: string): UnsequencedResponseStreamEvent[] {
    const out: UnsequencedResponseStreamEvent[] = [];
    out.push(...this.ensureTextPart(streamId));

    const st = this.textItems.get(streamId);
    if (!st || st.outputItemDone) return out;
    st.text += delta;

    out.push({
      type: 'response.output_text.delta',
      output_index: st.outputIndex,
      item_id: st.itemId,
      content_index: st.contentIndex,
      delta,
      logprobs: [],
    });

    return out;
  }

  doneOutputText(streamId: string, text?: string): UnsequencedResponseStreamEvent[] {
    const out: UnsequencedResponseStreamEvent[] = [];
    out.push(...this.ensureTextPart(streamId));

    const st = this.textItems.get(streamId);
    if (!st || st.outputItemDone) return out;
    if (st.outputTextDone) return out;
    if (typeof text === 'string') st.text = text;

    const item = this.output[st.outputIndex];
    if (!item || item.type !== 'message') return out;

    const part: ResponseOutputText = { type: 'output_text', text: st.text, annotations: [] };
    if (item.content.length === 0) item.content.push(part);
    else item.content[0] = part;

    st.outputTextDone = true;

    out.push({
      type: 'response.output_text.done',
      output_index: st.outputIndex,
      item_id: st.itemId,
      content_index: st.contentIndex,
      text: st.text,
      logprobs: [],
    });

    return out;
  }

  doneContentPart(streamId: string): UnsequencedResponseStreamEvent[] {
    const out: UnsequencedResponseStreamEvent[] = [];
    out.push(...this.ensureTextPart(streamId));

    const st = this.textItems.get(streamId);
    if (!st || st.outputItemDone) return out;
    if (st.contentPartDone) return out;

    const item = this.output[st.outputIndex];
    if (!item || item.type !== 'message') return out;

    const part: ResponseOutputText = { type: 'output_text', text: st.text, annotations: [] };
    if (item.content.length === 0) item.content.push(part);
    else item.content[0] = part;

    st.contentPartDone = true;

    out.push({
      type: 'response.content_part.done',
      output_index: st.outputIndex,
      item_id: st.itemId,
      content_index: st.contentIndex,
      part: cloneOutputTextPart(part),
    });

    return out;
  }

  doneMessageItem(streamId: string): UnsequencedResponseStreamEvent[] {
    const out: UnsequencedResponseStreamEvent[] = [];
    out.push(...this.ensureTextPart(streamId));

    const st = this.textItems.get(streamId);
    if (!st || st.outputItemDone) return out;

    const item = this.output[st.outputIndex];
    if (!item || item.type !== 'message') return out;

    const part: ResponseOutputText = { type: 'output_text', text: st.text, annotations: [] };
    if (item.content.length === 0) item.content.push(part);
    else item.content[0] = part;

    st.outputItemDone = true;
    item.status = 'completed';

    out.push({
      type: 'response.output_item.done',
      output_index: st.outputIndex,
      item: cloneOutputItem(item),
    });

    return out;
  }

  finishText(streamId: string, text?: string): UnsequencedResponseStreamEvent[] {
    const out: UnsequencedResponseStreamEvent[] = [];
    out.push(...this.doneOutputText(streamId, text));
    out.push(...this.doneContentPart(streamId));
    out.push(...this.doneMessageItem(streamId));
    return out;
  }

  hasFunctionCall(callId: string): boolean {
    return this.functionCalls.has(callId);
  }

  startFunctionCall(
    callId: string,
    toolName: string,
    itemId?: string,
  ): UnsequencedResponseStreamEvent[] {
    if (this.functionCalls.has(callId)) return [];

    const outputIndex = this.output.length;
    const resolvedItemId = itemId ?? this.itemIdFn();
    const item: ResponseFunctionToolCall = {
      id: resolvedItemId,
      type: 'function_call',
      call_id: callId,
      name: toolName,
      arguments: '',
      status: 'in_progress',
    };

    this.output.push(item);
    this.functionCalls.set(callId, {
      outputIndex,
      itemId: resolvedItemId,
      name: toolName,
      args: '',
      done: false,
    });

    return [
      {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: cloneOutputItem(item),
      },
    ];
  }

  appendFunctionCallArgs(callId: string, delta: string): UnsequencedResponseStreamEvent[] {
    const st = this.functionCalls.get(callId);
    if (!st || st.done) return [];
    st.args += delta;
    return [
      {
        type: 'response.function_call_arguments.delta',
        output_index: st.outputIndex,
        item_id: st.itemId,
        delta,
      },
    ];
  }

  finishFunctionCallArgs(
    callId: string,
    args: string,
    toolName?: string,
  ): UnsequencedResponseStreamEvent[] {
    const st = this.functionCalls.get(callId);
    if (!st || st.done) return [];
    st.args = args;

    const item = this.output[st.outputIndex];
    if (item && item.type === 'function_call') item.arguments = args;
    return [
      {
        type: 'response.function_call_arguments.done',
        output_index: st.outputIndex,
        item_id: st.itemId,
        name: toolName ?? st.name,
        arguments: args,
      },
    ];
  }

  finishFunctionCall(callId: string, args: string): UnsequencedResponseStreamEvent[] {
    const st = this.functionCalls.get(callId);
    if (!st || st.done) return [];
    st.done = true;
    st.args = args;

    const item = this.output[st.outputIndex];
    if (!item || item.type !== 'function_call') return [];
    item.arguments = st.args;
    item.status = 'completed';

    return [
      {
        type: 'response.output_item.done',
        output_index: st.outputIndex,
        item: cloneOutputItem(item),
      },
    ];
  }
}
