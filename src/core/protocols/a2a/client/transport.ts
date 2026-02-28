import type { A2ASubscribeOptions } from './http-transport.js';
import type { A2AJsonRpcRequest } from './types.js';

export interface A2AClientTransport {
  request(payload: A2AJsonRpcRequest): Promise<unknown>;
  subscribe(taskId: string, options?: A2ASubscribeOptions): Promise<Response>;
}
