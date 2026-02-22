import type { CanonicalResponsesEvent } from '../../core/streaming/canonical/responses-events.js';

import type { UnsequencedResponseStreamEvent } from './openai-responses-state.js';
import { OpenAiResponsesState } from './openai-responses-state.js';

function parseFunctionCallId(itemId?: string): string | null {
  if (!itemId) return null;
  const prefix = 'function_call:';
  if (!itemId.startsWith(prefix)) return null;
  const callId = itemId.slice(prefix.length);
  return callId ? callId : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

export class OpenAiResponsesCanonicalApplier {
  constructor(private readonly state: OpenAiResponsesState) {}

  apply(params: {
    streamId: string;
    event: CanonicalResponsesEvent;
  }): UnsequencedResponseStreamEvent[] {
    const { streamId, event } = params;

    switch (event.type) {
      case 'response.output_item.added': {
        if (!isRecord(event)) return [];
        const itemUnknown = event.item;
        if (!isRecord(itemUnknown)) return [];

        const itemType = getString(itemUnknown, 'type');
        if (itemType === 'function_call') {
          const callId = getString(itemUnknown, 'call_id');
          const toolName = getString(itemUnknown, 'name');
          if (!callId || !toolName) return [];
          const itemId = getString(itemUnknown, 'id') ?? undefined;
          return this.state.startFunctionCall(callId, toolName, itemId);
        }

        if (itemType === 'message') {
          const itemId = getString(itemUnknown, 'id') ?? undefined;
          return this.state.ensureAssistantMessage(streamId, itemId);
        }

        return [];
      }

      case 'response.function_call_arguments.delta': {
        const callId = parseFunctionCallId(
          (
            event as Extract<
              CanonicalResponsesEvent,
              { type: 'response.function_call_arguments.delta' }
            >
          ).item_id as string | undefined,
        );
        if (!callId) return [];
        if (typeof event.delta !== 'string') return [];
        return this.state.appendFunctionCallArgs(callId, event.delta);
      }

      case 'response.function_call_arguments.done': {
        const callId = parseFunctionCallId(
          (
            event as Extract<
              CanonicalResponsesEvent,
              { type: 'response.function_call_arguments.done' }
            >
          ).item_id as string | undefined,
        );
        if (!callId) return [];
        if (typeof event.arguments !== 'string') return [];
        const name = typeof event.name === 'string' ? event.name : undefined;
        return this.state.finishFunctionCallArgs(callId, event.arguments, name);
      }

      case 'response.output_item.done': {
        if (!isRecord(event)) return [];
        const itemUnknown = event.item;
        if (!isRecord(itemUnknown)) return [];

        const itemType = getString(itemUnknown, 'type');
        if (itemType === 'function_call') {
          const callId = getString(itemUnknown, 'call_id');
          const args = getString(itemUnknown, 'arguments');
          if (!callId || args === null) return [];
          return this.state.finishFunctionCall(callId, args);
        }

        if (itemType === 'message') return this.state.doneMessageItem(streamId);

        return [];
      }

      case 'response.content_part.added': {
        return this.state.ensureTextPart(streamId);
      }

      case 'response.output_text.delta': {
        if (typeof event.delta !== 'string') return [];
        return this.state.appendTextDelta(streamId, event.delta);
      }

      case 'response.output_text.done': {
        const text = isRecord(event) && typeof event.text === 'string' ? event.text : undefined;
        return this.state.doneOutputText(streamId, text);
      }

      case 'response.content_part.done': {
        return this.state.doneContentPart(streamId);
      }

      default: {
        return [];
      }
    }
  }
}
