import { createA2AClient } from './client.js';
import { createA2AHttpTransport } from './http-transport.js';
import type {
  A2AClearTimeout,
  A2AFetchLike,
  A2AReconnectOptions,
  A2ASetTimeout,
} from './http-transport.js';

export function createA2AHttpClient(deps: {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: A2AFetchLike;
  timeoutMs?: number;
  delayMs?: (ms: number) => Promise<void>;
  reconnect?: A2AReconnectOptions;
  setTimeout?: A2ASetTimeout;
  clearTimeout?: A2AClearTimeout;
}) {
  const transport = createA2AHttpTransport(deps);
  return createA2AClient({ transport });
}
