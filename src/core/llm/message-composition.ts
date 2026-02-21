import type { LLMMessage } from '../types/index.js';

function toSafeConversationMessage(msg: LLMMessage): LLMMessage | null {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.role !== 'user' && msg.role !== 'assistant') return null;
  if (typeof msg.content !== 'string') return null;
  const content = msg.content.trimEnd();
  if (!content) return null;
  return { role: msg.role, content };
}

export function composeChatMessages(params: {
  system: string;
  user: string;
  conversationContext?: LLMMessage[];
}): LLMMessage[] {
  const out: LLMMessage[] = [{ role: 'system', content: String(params.system ?? '') }];

  if (Array.isArray(params.conversationContext)) {
    for (const msg of params.conversationContext) {
      const safe = toSafeConversationMessage(msg);
      if (safe) out.push(safe);
    }
  }

  out.push({ role: 'user', content: String(params.user ?? '') });
  return out;
}
