import type { TaskEventBus } from '../../../interaction/events/bus.js';

export interface A2AEventSource {
  open(taskId: string): Response;
}

export function createSseEventSource(bus?: TaskEventBus): A2AEventSource {
  return {
    open(taskId: string) {
      let unsubscribe: (() => void) | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!bus) {
            controller.enqueue(
              new TextEncoder().encode(`event: task.subscribed\ndata: {"taskId":"${taskId}"}\n\n`),
            );
            return;
          }

          unsubscribe = bus.subscribe((event) => {
            if (event.taskId !== taskId) return;
            controller.enqueue(
              new TextEncoder().encode(
                `event: ${event.type}\ndata: ${JSON.stringify({ taskId: event.taskId, type: event.type })}\n\n`,
              ),
            );
          });
        },
        cancel() {
          unsubscribe?.();
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
