export type CanonicalResponsesEventSource = 'provider' | 'synthesized';

export type CanonicalResponsesEvent =
  | CanonicalResponseOutputTextDeltaEvent
  | CanonicalResponseOutputTextDoneEvent
  | CanonicalResponsesEventUnknown;

export interface CanonicalResponseOutputTextDeltaEvent {
  type: 'response.output_text.delta';
  delta: string;
}

export interface CanonicalResponseOutputTextDoneEvent {
  type: 'response.output_text.done';
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
