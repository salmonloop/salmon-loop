import type { TaskEventBus } from '../../../interaction/events/bus.js';

export interface A2AEventSource {
  open(taskId: string, request?: Request): Response;
}

export function createSseEventSource(
  bus?: TaskEventBus,
  options?: {
    maxReplayEvents?: number;
    heartbeatIntervalMs?: number;
    setInterval?: typeof globalThis.setInterval;
    clearInterval?: typeof globalThis.clearInterval;
  },
): A2AEventSource {
  return {
    open(taskId: string, request?: Request) {
      let unsubscribe: (() => void) | undefined;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      const lastEventId =
        request?.headers.get('last-event-id') ??
        (request ? new URL(request.url).searchParams.get('lastEventId') : null);

      const encodeEvent = (event: { id?: string; taskId: string; type: string }) =>
        new TextEncoder().encode(
          `id: ${event.id ?? ''}\nevent: ${event.type}\ndata: ${JSON.stringify({ taskId: event.taskId, type: event.type })}\n\n`,
        );

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!bus) {
            controller.enqueue(
              new TextEncoder().encode(`event: task.subscribed\ndata: {"taskId":"${taskId}"}\n\n`),
            );
            if (options?.heartbeatIntervalMs) {
              const scheduleInterval = options.setInterval ?? globalThis.setInterval;
              heartbeatTimer = scheduleInterval(() => {
                controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
              }, options.heartbeatIntervalMs);
            }
            return;
          }

          const replayEvents = bus
            .list(taskId, { afterId: lastEventId })
            .slice(-(options?.maxReplayEvents ?? Number.POSITIVE_INFINITY));
          for (const event of replayEvents) {
            controller.enqueue(encodeEvent(event));
          }

          unsubscribe = bus.subscribe((event) => {
            if (event.taskId !== taskId) return;
            if (lastEventId && event.id && Number(event.id) <= Number(lastEventId)) return;
            controller.enqueue(encodeEvent(event));
          });

          if (options?.heartbeatIntervalMs) {
            const scheduleInterval = options.setInterval ?? globalThis.setInterval;
            heartbeatTimer = scheduleInterval(() => {
              controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
            }, options.heartbeatIntervalMs);
          }
        },
        cancel() {
          unsubscribe?.();
          if (heartbeatTimer) {
            const cancelInterval = options?.clearInterval ?? globalThis.clearInterval;
            cancelInterval(heartbeatTimer);
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      });
    },
  };
}
