import type {
  CanonicalResponseFunctionCallItem,
  CanonicalResponseMessageItem,
  CanonicalResponseOutputTextPart,
  CanonicalResponseOutputItemAddedEvent,
  CanonicalResponseOutputItemDoneEvent,
  CanonicalResponseOutputTextDeltaEvent,
  CanonicalResponseOutputTextDoneEvent,
  CanonicalResponseContentPartAddedEvent,
  CanonicalResponseContentPartDoneEvent,
  CanonicalResponseFunctionCallArgumentsDeltaEvent,
  CanonicalResponseFunctionCallArgumentsDoneEvent,
} from './responses-events.js';

export function createResponseOutputTextDeltaEvent(
  params:
    | string
    | {
        delta: string;
        outputIndex?: number;
        itemId?: string;
        contentIndex?: number;
        logprobs?: unknown[];
      },
): CanonicalResponseOutputTextDeltaEvent {
  if (typeof params === 'string') {
    return { type: 'response.output_text.delta', delta: params };
  }
  return {
    type: 'response.output_text.delta',
    delta: params.delta,
    output_index: params.outputIndex,
    item_id: params.itemId,
    content_index: params.contentIndex,
    logprobs: params.logprobs,
  };
}

export function createResponseOutputTextDoneEvent(params?: {
  outputIndex?: number;
  itemId?: string;
  contentIndex?: number;
  text?: string;
  logprobs?: unknown[];
}): CanonicalResponseOutputTextDoneEvent {
  return {
    type: 'response.output_text.done',
    output_index: params?.outputIndex,
    item_id: params?.itemId,
    content_index: params?.contentIndex,
    text: params?.text,
    logprobs: params?.logprobs,
  };
}

export function createResponseOutputItemAddedMessageEvent(params: {
  itemId: string;
  role: 'assistant' | 'user';
  outputIndex?: number;
}): CanonicalResponseOutputItemAddedEvent {
  const item: CanonicalResponseMessageItem = {
    id: params.itemId,
    type: 'message',
    role: params.role,
    status: 'in_progress',
    content: [],
  };
  return {
    type: 'response.output_item.added',
    output_index: params.outputIndex,
    item,
  };
}

export function createResponseOutputItemDoneMessageEvent(params: {
  itemId: string;
  role: 'assistant' | 'user';
  content: CanonicalResponseMessageItem['content'];
  outputIndex?: number;
}): CanonicalResponseOutputItemDoneEvent {
  const item: CanonicalResponseMessageItem = {
    id: params.itemId,
    type: 'message',
    role: params.role,
    status: 'completed',
    content: params.content,
  };
  return {
    type: 'response.output_item.done',
    output_index: params.outputIndex,
    item,
  };
}

export function createResponseContentPartAddedOutputTextEvent(params: {
  itemId: string;
  contentIndex?: number;
  outputIndex?: number;
}): CanonicalResponseContentPartAddedEvent {
  const part: CanonicalResponseOutputTextPart = {
    type: 'output_text',
    text: '',
    annotations: [],
  };
  return {
    type: 'response.content_part.added',
    output_index: params.outputIndex,
    item_id: params.itemId,
    content_index: params.contentIndex,
    part,
  };
}

export function createResponseContentPartDoneOutputTextEvent(params: {
  itemId: string;
  contentIndex?: number;
  outputIndex?: number;
  text: string;
}): CanonicalResponseContentPartDoneEvent {
  const part: CanonicalResponseOutputTextPart = {
    type: 'output_text',
    text: params.text,
    annotations: [],
  };
  return {
    type: 'response.content_part.done',
    output_index: params.outputIndex,
    item_id: params.itemId,
    content_index: params.contentIndex,
    part,
  };
}

export function createResponseFunctionCallArgumentsDeltaEvent(params: {
  itemId: string;
  outputIndex?: number;
  delta: string;
}): CanonicalResponseFunctionCallArgumentsDeltaEvent {
  return {
    type: 'response.function_call_arguments.delta',
    output_index: params.outputIndex,
    item_id: params.itemId,
    delta: params.delta,
  };
}

export function createResponseFunctionCallArgumentsDoneEvent(params: {
  itemId: string;
  outputIndex?: number;
  name?: string;
  argumentsText: string;
}): CanonicalResponseFunctionCallArgumentsDoneEvent {
  return {
    type: 'response.function_call_arguments.done',
    output_index: params.outputIndex,
    item_id: params.itemId,
    name: params.name,
    arguments: params.argumentsText,
  };
}

export function createResponseOutputItemAddedFunctionCallEvent(params: {
  itemId?: string;
  callId: string;
  name: string;
  argumentsText: string;
  outputIndex?: number;
}): CanonicalResponseOutputItemAddedEvent {
  const item: CanonicalResponseFunctionCallItem = {
    id: params.itemId,
    type: 'function_call',
    call_id: params.callId,
    name: params.name,
    arguments: params.argumentsText,
    status: 'in_progress',
  };
  return {
    type: 'response.output_item.added',
    output_index: params.outputIndex,
    item,
  };
}

export function createResponseOutputItemDoneFunctionCallEvent(params: {
  itemId?: string;
  callId: string;
  name: string;
  argumentsText: string;
  outputIndex?: number;
}): CanonicalResponseOutputItemDoneEvent {
  const item: CanonicalResponseFunctionCallItem = {
    id: params.itemId,
    type: 'function_call',
    call_id: params.callId,
    name: params.name,
    arguments: params.argumentsText,
    status: 'completed',
  };
  return {
    type: 'response.output_item.done',
    output_index: params.outputIndex,
    item,
  };
}
