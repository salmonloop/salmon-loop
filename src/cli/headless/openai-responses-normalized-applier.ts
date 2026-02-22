import type { NormalizedStreamEvent } from '../../core/streaming/normalized-events.js';

import type { UnsequencedResponseStreamEvent } from './openai-responses-state.js';
import { OpenAiResponsesState } from './openai-responses-state.js';

const REDACTED_TOOL_ARGS = '{}';

export class OpenAiResponsesNormalizedApplier {
  constructor(private readonly state: OpenAiResponsesState) {}

  apply(event: NormalizedStreamEvent): UnsequencedResponseStreamEvent[] {
    switch (event.type) {
      case 'normalized.content_block_start': {
        if (event.blockType !== 'text') return [];
        return this.state.ensureTextPart(event.messageId);
      }

      case 'normalized.content_block_delta': {
        if (event.deltaType !== 'text') return [];
        return this.state.appendTextDelta(event.messageId, event.text);
      }

      case 'normalized.message_end': {
        return this.state.finishText(event.messageId);
      }

      case 'normalized.tool_request_start': {
        return [
          ...this.state.startFunctionCall(event.callId, event.toolName),
          ...this.state.appendFunctionCallArgs(event.callId, REDACTED_TOOL_ARGS),
        ];
      }

      case 'normalized.tool_call_end': {
        return [
          ...this.state.finishFunctionCallArgs(event.callId, REDACTED_TOOL_ARGS, event.toolName),
          ...this.state.finishFunctionCall(event.callId, REDACTED_TOOL_ARGS),
        ];
      }

      default: {
        return [];
      }
    }
  }
}
