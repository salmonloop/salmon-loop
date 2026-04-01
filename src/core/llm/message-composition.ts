import type { LLMMessage } from '../types/llm.js';

import { buildRequestEnvelope, materializeRequestEnvelope } from './request-envelope.js';

export function composeChatMessages(params: {
  system: string;
  user: string;
  conversationContext?: LLMMessage[];
}): LLMMessage[] {
  return materializeRequestEnvelope(
    buildRequestEnvelope({
      system: params.system,
      user: params.user,
      conversationContext: params.conversationContext,
    }),
  );
}
