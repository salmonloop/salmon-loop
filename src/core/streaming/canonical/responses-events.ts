export type CanonicalResponsesEventSource = 'provider' | 'synthesized';

export type CanonicalResponsesEvent =
  | CanonicalResponseOutputTextDeltaEvent
  | CanonicalResponseOutputTextDoneEvent
  | CanonicalResponseOutputItemAddedEvent
  | CanonicalResponseOutputItemDoneEvent
  | CanonicalResponseContentPartAddedEvent
  | CanonicalResponseContentPartDoneEvent
  | CanonicalResponseFunctionCallArgumentsDeltaEvent
  | CanonicalResponseFunctionCallArgumentsDoneEvent
  | CanonicalResponsesEventUnknown;

export interface CanonicalResponseOutputTextDeltaEvent {
  type: 'response.output_text.delta';
  delta: string;
  output_index?: number;
  item_id?: string;
  content_index?: number;
  logprobs?: unknown[];
}

export interface CanonicalResponseOutputTextDoneEvent {
  type: 'response.output_text.done';
  output_index?: number;
  item_id?: string;
  content_index?: number;
  text?: string;
  logprobs?: unknown[];
}

export type CanonicalResponseOutputItem =
  | CanonicalResponseFunctionCallItem
  | CanonicalResponseMessageItem;

export interface CanonicalResponseFunctionCallItem {
  id?: string;
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  status?: 'in_progress' | 'completed';
}

export interface CanonicalResponseMessageItem {
  type: 'message';
  role: 'assistant' | 'user';
  status?: 'in_progress' | 'completed';
  content: CanonicalResponseContentPart[];
  id?: string;
}

export interface CanonicalResponseOutputItemAddedEvent {
  type: 'response.output_item.added';
  output_index?: number;
  item: CanonicalResponseOutputItem;
}

export interface CanonicalResponseOutputItemDoneEvent {
  type: 'response.output_item.done';
  output_index?: number;
  item: CanonicalResponseOutputItem;
}

export type CanonicalResponseContentPart = CanonicalResponseOutputTextPart;

export interface CanonicalResponseOutputTextPart {
  type: 'output_text';
  text: string;
  annotations?: unknown[];
}

export interface CanonicalResponseContentPartAddedEvent {
  type: 'response.content_part.added';
  output_index?: number;
  item_id?: string;
  content_index?: number;
  part: CanonicalResponseContentPart;
}

export interface CanonicalResponseContentPartDoneEvent {
  type: 'response.content_part.done';
  output_index?: number;
  item_id?: string;
  content_index?: number;
  part: CanonicalResponseContentPart;
}

export interface CanonicalResponseFunctionCallArgumentsDeltaEvent {
  type: 'response.function_call_arguments.delta';
  output_index?: number;
  item_id?: string;
  delta: string;
}

export interface CanonicalResponseFunctionCallArgumentsDoneEvent {
  type: 'response.function_call_arguments.done';
  output_index?: number;
  item_id?: string;
  name?: string;
  arguments: string;
}

export type CanonicalResponsesEventUnknown = {
  /**
   * OpenAI-like event discriminator.
   *
   * This IR is intentionally forward-compatible: adapters may emit event types
   * not yet modeled here, and downstream consumers should ignore what they
   * don't understand.
   */
  type: string;
} & Record<string, unknown>;
