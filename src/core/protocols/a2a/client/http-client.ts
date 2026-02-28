import { type TaskEnvelope } from '../../../interaction/model/index.js';

import { createA2AClient } from './client.js';
import {
  createA2AHttpTransport,
  type A2AClearTimeout,
  type A2AFetchLike,
  type A2AReconnectOptions,
  type A2ASetTimeout,
} from './http-transport.js';

export function createA2AHttpClient(deps: {
  baseUrl: string;
  headers?: Record<string, string>;
  defaultOptions?: {
    headers?: Record<string, string>;
    reconnect?: A2AReconnectOptions;
    idleTimeoutMs?: number;
  };
  fetch?: A2AFetchLike;
  timeoutMs?: number;
  delayMs?: (ms: number) => Promise<void>;
  reconnect?: A2AReconnectOptions;
  setTimeout?: A2ASetTimeout;
  clearTimeout?: A2AClearTimeout;
}) {
  const transport = createA2AHttpTransport({
    baseUrl: deps.baseUrl,
    headers: { ...(deps.headers ?? {}), ...(deps.defaultOptions?.headers ?? {}) },
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    delayMs: deps.delayMs,
    reconnect: deps.defaultOptions?.reconnect ?? deps.reconnect,
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
  });
  const client = createA2AClient({ transport });

  return {
    startTask: (input: { instruction: string }, options?: { headers?: Record<string, string> }) =>
      client.startTask(input, options),
    syncTask: (
      taskId: string,
      options?: {
        sinceEventId?: string;
        requireReplay?: boolean;
        headers?: Record<string, string>;
      },
    ) => client.syncTask(taskId, options),
    subscribeTask: (
      taskId: string,
      handler: (task: TaskEnvelope) => void,
      options?: {
        lastEventId?: string;
        reconnect?: A2AReconnectOptions;
        idleTimeoutMs?: number;
        autoSyncOnEnd?: boolean;
        onSync?: (task: TaskEnvelope) => void;
        headers?: Record<string, string>;
      },
    ) =>
      client.subscribeTask(taskId, handler, {
        ...options,
        idleTimeoutMs: options?.idleTimeoutMs ?? deps.defaultOptions?.idleTimeoutMs,
      }),
  };
}
