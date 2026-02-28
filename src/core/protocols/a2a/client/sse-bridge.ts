import type { TaskEvent } from '../../../interaction/events/bus.js';
import { decodeSseEvents } from '../../../tools/mcp/streamable-http.js';

export function createA2ASseSubscriptionBridge() {
  function parseFailure(value: unknown): TaskEvent['failure'] | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Record<string, unknown>;
    const category = typeof candidate.category === 'string' ? candidate.category : undefined;
    const code = typeof candidate.code === 'string' ? candidate.code : undefined;
    if (!category && !code) return undefined;
    return { category, code };
  }

  function parseRequiredAction(value: unknown): TaskEvent['requiredAction'] | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Record<string, unknown>;
    const type = typeof candidate.type === 'string' ? candidate.type : undefined;
    if (!type) return undefined;
    const reason = typeof candidate.reason === 'string' ? candidate.reason : undefined;
    return { type, reason };
  }

  async function consumeStream(
    stream: ReadableStream<Uint8Array>,
    handler: (event: TaskEvent) => void,
  ): Promise<void> {
    for await (const event of decodeSseEvents(stream)) {
      if (!event.data) continue;
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const taskId = typeof payload.taskId === 'string' ? payload.taskId : undefined;
      const type = typeof payload.type === 'string' ? payload.type : event.event;
      if (!taskId || !type) continue;

      handler({
        id: event.id,
        taskId,
        type,
        state: typeof payload.state === 'string' ? payload.state : undefined,
        attempt: typeof payload.attempt === 'number' ? payload.attempt : undefined,
        failure: parseFailure(payload.failure),
        requiredAction: parseRequiredAction(payload.requiredAction),
      });
    }
  }

  return { consumeStream };
}
