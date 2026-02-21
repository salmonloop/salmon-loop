import type {
  CanonicalResponseFunctionCallItem,
  CanonicalResponseOutputItemAddedEvent,
  CanonicalResponseOutputTextDeltaEvent,
  CanonicalResponseOutputTextDoneEvent,
} from './responses-events.js';

export function createResponseOutputTextDeltaEvent(
  delta: string,
): CanonicalResponseOutputTextDeltaEvent {
  return { type: 'response.output_text.delta', delta };
}

export function createResponseOutputTextDoneEvent(): CanonicalResponseOutputTextDoneEvent {
  return { type: 'response.output_text.done' };
}

export function createResponseOutputItemAddedFunctionCallEvent(params: {
  callId: string;
  name: string;
  argumentsText: string;
  outputIndex?: number;
}): CanonicalResponseOutputItemAddedEvent {
  const item: CanonicalResponseFunctionCallItem = {
    type: 'function_call',
    call_id: params.callId,
    name: params.name,
    arguments: params.argumentsText,
  };
  return {
    type: 'response.output_item.added',
    output_index: params.outputIndex,
    item,
  };
}
