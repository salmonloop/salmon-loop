import type { SseEvent } from '../../../tools/mcp/streamable-http.js';
import { decodeSseEvents, isEventStreamResponse } from '../../../tools/mcp/streamable-http.js';

import type { A2AClientTransport } from './transport.js';
import type { A2AJsonRpcRequest } from './types.js';

const DEFAULT_ACCEPT = {
  json: 'application/json',
  sse: 'text/event-stream',
};

export type A2AFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type A2AReconnectOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export function createA2AHttpTransport(deps: {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: A2AFetchLike;
  timeoutMs?: number;
  delayMs?: (ms: number) => Promise<void>;
  reconnect?: A2AReconnectOptions;
}): A2AClientTransport {
  const baseUrl = deps.baseUrl.replace(/\/$/, '');
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const delayMs =
    deps.delayMs ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const reconnectDefaults = deps.reconnect ?? {};

  function resolveReconnect(options?: A2AReconnectOptions) {
    const reconnect = options ?? reconnectDefaults;
    return {
      maxRetries: reconnect.maxRetries ?? 0,
      baseDelayMs: reconnect.baseDelayMs ?? 250,
      maxDelayMs: reconnect.maxDelayMs ?? 2000,
    };
  }

  function encodeSseEvent(event: SseEvent): Uint8Array {
    let text = '';
    if (event.id) text += `id: ${event.id}\n`;
    if (event.event) text += `event: ${event.event}\n`;
    if (typeof event.retry === 'number') text += `retry: ${event.retry}\n`;
    if (event.data) {
      for (const line of event.data.split('\n')) {
        text += `data: ${line}\n`;
      }
    }
    text += '\n';
    return new TextEncoder().encode(text);
  }

  async function request(payload: A2AJsonRpcRequest): Promise<unknown> {
    const controller = deps.timeoutMs ? new AbortController() : null;
    const timeout = deps.timeoutMs ? setTimeout(() => controller?.abort(), deps.timeoutMs) : null;

    try {
      const response = await fetchImpl(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          Accept: DEFAULT_ACCEPT.json,
          'Content-Type': 'application/json',
          ...(deps.headers ?? {}),
        },
        body: JSON.stringify(payload),
        signal: controller?.signal,
      });

      if (!response.ok) {
        throw new Error(`A2A RPC request failed with HTTP ${response.status}`);
      }

      return response.json();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function subscribe(
    taskId: string,
    options?: { lastEventId?: string; reconnect?: A2AReconnectOptions },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: DEFAULT_ACCEPT.sse,
      ...(deps.headers ?? {}),
    };
    const reconnect = resolveReconnect(options?.reconnect);
    let cancelStream: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let aborted = false;
        let lastEventId = options?.lastEventId;
        let attempts = 0;
        let activeController: AbortController | null = null;

        const cancelCurrent = () => {
          aborted = true;
          activeController?.abort();
        };

        cancelStream = cancelCurrent;

        const run = async () => {
          while (!aborted) {
            activeController = new AbortController();
            const requestHeaders = {
              ...headers,
              ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
            };

            try {
              const response = await fetchImpl(`${baseUrl}/tasks/${taskId}/subscribe`, {
                method: 'GET',
                headers: requestHeaders,
                signal: activeController.signal,
              });

              if (!response.ok) {
                throw new Error(`A2A SSE subscription failed with HTTP ${response.status}`);
              }

              if (!isEventStreamResponse(response)) {
                throw new Error('A2A SSE subscription did not return text/event-stream');
              }

              if (!response.body) {
                throw new Error('A2A SSE response missing body');
              }

              for await (const event of decodeSseEvents(response.body)) {
                if (aborted) break;
                if (event.id) lastEventId = event.id;
                controller.enqueue(encodeSseEvent(event));
              }

              if (attempts >= reconnect.maxRetries) {
                break;
              }
            } catch (err) {
              if (attempts >= reconnect.maxRetries) {
                controller.error(err);
                break;
              }
            }

            attempts += 1;
            const delay = Math.min(
              reconnect.maxDelayMs,
              reconnect.baseDelayMs * 2 ** (attempts - 1),
            );
            await delayMs(delay);
          }

          if (!controller.desiredSize) return;
          controller.close();
          cancelCurrent();
        };

        run().catch((err) => controller.error(err));
      },
      cancel() {
        cancelStream?.();
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
  }

  return { request, subscribe };
}
