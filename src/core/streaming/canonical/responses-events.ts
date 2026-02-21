export type CanonicalResponsesEventSource = 'provider' | 'synthesized';

export type CanonicalResponsesEvent =
  | CanonicalResponseOutputTextDeltaEvent
  | CanonicalResponseOutputTextDoneEvent
  | CanonicalResponseOutputItemAddedEvent
  | CanonicalResponseOutputItemDoneEvent
  | CanonicalResponsesEventUnknown;

export interface CanonicalResponseOutputTextDeltaEvent {
  type: 'response.output_text.delta';
  delta: string;
}

export interface CanonicalResponseOutputTextDoneEvent {
  type: 'response.output_text.done';
}

export type CanonicalResponseOutputItem = CanonicalResponseFunctionCallItem;

export interface CanonicalResponseFunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
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
