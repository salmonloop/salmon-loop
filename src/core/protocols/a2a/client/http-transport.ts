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
  jitterRatio?: number;
  resetWindowMs?: number;
};

export type A2ASubscribeOptions = {
  lastEventId?: string;
  reconnect?: A2AReconnectOptions;
  idleTimeoutMs?: number;
  headers?: Record<string, string>;
};

export type A2ASetTimeout = (handler: () => void, timeout?: number) => unknown;
export type A2AClearTimeout = (handle: unknown) => void;

export function createA2AHttpTransport(deps: {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: A2AFetchLike;
  timeoutMs?: number;
  delayMs?: (ms: number) => Promise<void>;
  reconnect?: A2AReconnectOptions;
  setTimeout?: A2ASetTimeout;
  clearTimeout?: A2AClearTimeout;
  random?: () => number;
  now?: () => number;
}): A2AClientTransport {
  const baseUrl = deps.baseUrl.replace(/\/$/, '');
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const delayMs =
    deps.delayMs ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const setTimeoutImpl: A2ASetTimeout =
    deps.setTimeout ?? ((handler, timeout) => globalThis.setTimeout(handler, timeout));
  const clearTimeoutImpl: A2AClearTimeout =
    deps.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as number));
  const reconnectDefaults = deps.reconnect ?? {};
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => Date.now());

  function resolveReconnect(options?: A2AReconnectOptions) {
    const reconnect = options ?? reconnectDefaults;
    return {
      maxRetries: reconnect.maxRetries ?? 0,
      baseDelayMs: reconnect.baseDelayMs ?? 250,
      maxDelayMs: reconnect.maxDelayMs ?? 2000,
      jitterRatio: reconnect.jitterRatio ?? 0,
      resetWindowMs: reconnect.resetWindowMs,
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

  async function request(
    payload: A2AJsonRpcRequest,
    options?: { headers?: Record<string, string> },
  ): Promise<unknown> {
    const controller = deps.timeoutMs ? new AbortController() : null;
    const timeout = deps.timeoutMs ? setTimeout(() => controller?.abort(), deps.timeoutMs) : null;

    try {
      const response = await fetchImpl(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          Accept: DEFAULT_ACCEPT.json,
          'Content-Type': 'application/json',
          ...(deps.headers ?? {}),
          ...(options?.headers ?? {}),
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

  async function subscribe(taskId: string, options?: A2ASubscribeOptions): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: DEFAULT_ACCEPT.sse,
      ...(deps.headers ?? {}),
      ...(options?.headers ?? {}),
    };
    const reconnect = resolveReconnect(options?.reconnect);
    let cancelStream: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let aborted = false;
        let lastEventId = options?.lastEventId;
        let attempts = 0;
        let connectedAt: number | null = null;
        let activeController: AbortController | null = null;
        let activeBody: ReadableStream<Uint8Array> | null = null;
        let idleTimer: ReturnType<A2ASetTimeout> | null = null;
        let idleExpired = false;

        const cancelCurrent = () => {
          aborted = true;
          activeController?.abort();
        };

        const clearIdleTimer = () => {
          if (!idleTimer) return;
          clearTimeoutImpl(idleTimer);
          idleTimer = null;
        };

        const resetIdleTimer = () => {
          clearIdleTimer();
          if (!options?.idleTimeoutMs) return;
          idleTimer = setTimeoutImpl(() => {
            idleExpired = true;
            try {
              controller.close();
            } catch {
              // ignore double-close
            }
            activeBody?.cancel().catch(() => undefined);
            cancelCurrent();
          }, options.idleTimeoutMs);
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

              activeBody = response.body;
              connectedAt = now();
              resetIdleTimer();
              for await (const event of decodeSseEvents(response.body)) {
                if (aborted) break;
                if (event.id) lastEventId = event.id;
                resetIdleTimer();
                controller.enqueue(encodeSseEvent(event));
              }

              if (
                reconnect.resetWindowMs &&
                connectedAt !== null &&
                now() - connectedAt >= reconnect.resetWindowMs
              ) {
                attempts = 0;
              }

              if (idleExpired || attempts >= reconnect.maxRetries) {
                break;
              }
            } catch (err) {
              if (idleExpired || attempts >= reconnect.maxRetries) {
                controller.error(err);
                break;
              }
            }

            attempts += 1;
            const delayBase = Math.min(
              reconnect.maxDelayMs,
              reconnect.baseDelayMs * 2 ** (attempts - 1),
            );
            const jitterRatio = reconnect.jitterRatio ?? 0;
            const jittered =
              jitterRatio > 0 ? delayBase * (1 + (random() * 2 - 1) * jitterRatio) : delayBase;
            const delay = Math.max(0, Math.min(reconnect.maxDelayMs, jittered));
            await delayMs(delay);
          }

          clearIdleTimer();
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
