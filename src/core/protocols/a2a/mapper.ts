import type { TaskEnvelope } from '../../interaction/model/index.js';

interface A2ATextPart {
  type: string;
  text?: string;
}

interface A2AMessageRequest {
  id: string;
  message: {
    role: string;
    parts: A2ATextPart[];
  };
  metadata?: Record<string, unknown>;
}

export function mapA2ATaskToCanonicalTask(input: A2AMessageRequest): TaskEnvelope {
  const instruction = input.message.parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');

  return {
    id: input.id,
    capability: 'patch',
    state: 'accepted',
    request: { instruction },
    createdAt: new Date().toISOString(),
  };
}
