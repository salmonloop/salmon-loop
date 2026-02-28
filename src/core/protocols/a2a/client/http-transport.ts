import type { A2AClientTransport } from './transport.js';
import type { A2AJsonRpcRequest } from './types.js';

const DEFAULT_ACCEPT = {
  json: 'application/json',
  sse: 'text/event-stream',
};

export type A2AFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createA2AHttpTransport(deps: {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: A2AFetchLike;
  timeoutMs?: number;
}): A2AClientTransport {
  const baseUrl = deps.baseUrl.replace(/\/$/, '');
  const fetchImpl = deps.fetch ?? globalThis.fetch;

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

  async function subscribe(taskId: string, options?: { lastEventId?: string }): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: DEFAULT_ACCEPT.sse,
      ...(deps.headers ?? {}),
    };
    if (options?.lastEventId) headers['Last-Event-ID'] = options.lastEventId;

    const response = await fetchImpl(`${baseUrl}/tasks/${taskId}/subscribe`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`A2A SSE subscription failed with HTTP ${response.status}`);
    }

    return response;
  }

  return { request, subscribe };
}
