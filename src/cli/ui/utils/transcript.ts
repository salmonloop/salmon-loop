import type { ChatMessage } from '../../../core/session/types.js';
import type { Message } from '../store/types.js';

export function buildTranscriptMessages(
  messages: ChatMessage[],
  options?: { limit?: number },
): Message[] {
  const limit = Math.max(0, Math.floor(options?.limit ?? 200));
  if (!Array.isArray(messages) || limit === 0) return [];

  const filtered: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (typeof msg.content !== 'string') continue;
    if (typeof msg.timestamp !== 'number' || !Number.isFinite(msg.timestamp)) continue;
    const content = msg.content.trimEnd();
    if (!content) continue;
    filtered.push({ role: msg.role, content, timestamp: msg.timestamp });
  }

  const slice = limit >= filtered.length ? filtered : filtered.slice(filtered.length - limit);

  return slice.map((m, i) => ({
    id: `transcript-${m.role}-${m.timestamp}-${i}`,
    type: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    timestamp: new Date(m.timestamp),
  }));
}
