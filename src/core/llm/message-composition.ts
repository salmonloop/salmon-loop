import type { LLMMessage } from '../types/llm.js';

import { buildSharedRequestEnvelope } from './shared-request-assembly.js';

export function composeChatMessages(params: {
  system: string;
  user: string;
  conversationContext?: LLMMessage[];
}): LLMMessage[] {
  return buildSharedRequestEnvelope({
    defaultNamespace: 'chat',
    systemPrompt: params.system,
    userPrompt: params.user,
    conversationContext: params.conversationContext,
  }).baseMessages;
}
