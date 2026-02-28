export interface A2AEventSource {
  open(taskId: string): Response;
}

export function createSseEventSource(): A2AEventSource {
  return {
    open(taskId: string) {
      const body = `event: task.subscribed\ndata: {"taskId":"${taskId}"}\n\n`;
      return new Response(body, {
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
