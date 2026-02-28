import type { TaskEnvelope } from '../../../interaction/model/index.js';
import { createTaskSyncEngine } from '../../../interaction/sync/task-sync-engine.js';

import type { A2AReconnectOptions } from './http-transport.js';
import { mapA2ATaskResultToCanonicalTask } from './inbound-mapper.js';
import { buildA2AJsonRpcRequest } from './outbound-mapper.js';
import { createA2ASseSubscriptionBridge } from './sse-bridge.js';
import type { A2AClientTransport } from './transport.js';
import type { A2ATaskResult } from './types.js';

interface JsonRpcSuccessResponse {
  result?: A2ATaskResult;
  error?: { code: number; message: string; data?: unknown };
}

function assertJsonRpcResult(response: unknown): A2ATaskResult {
  if (!response || typeof response !== 'object') {
    throw new Error('A2A response is not an object');
  }
  const payload = response as JsonRpcSuccessResponse;
  if (payload.error) {
    throw new Error(`A2A Error [${payload.error.code}]: ${payload.error.message}`);
  }
  if (!payload.result) {
    throw new Error('A2A response missing result');
  }
  return payload.result;
}

export function createA2AClient(deps: { transport: A2AClientTransport }) {
  const sync = createTaskSyncEngine();
  const sseBridge = createA2ASseSubscriptionBridge();

  async function startTask(input: { instruction: string }): Promise<TaskEnvelope> {
    const payload = buildA2AJsonRpcRequest({
      requestId: crypto.randomUUID(),
      action: 'start',
      instruction: input.instruction,
    });
    const response = await deps.transport.request(payload);
    const task = mapA2ATaskResultToCanonicalTask(assertJsonRpcResult(response));
    const enriched = { ...task, request: { instruction: input.instruction } };
    return sync.applySnapshot(enriched);
  }

  async function syncTask(
    taskId: string,
    options?: { sinceEventId?: string; requireReplay?: boolean },
  ): Promise<TaskEnvelope> {
    const payload = buildA2AJsonRpcRequest({
      requestId: crypto.randomUUID(),
      action: 'get',
      taskId,
      sinceEventId: options?.sinceEventId,
      requireReplay: options?.requireReplay,
    });
    const response = await deps.transport.request(payload);
    const task = mapA2ATaskResultToCanonicalTask(assertJsonRpcResult(response));
    return sync.applySnapshot(task);
  }

  async function subscribeTask(
    taskId: string,
    handler: (task: TaskEnvelope) => void,
    options?: {
      lastEventId?: string;
      reconnect?: A2AReconnectOptions;
      idleTimeoutMs?: number;
      autoSyncOnEnd?: boolean;
      onSync?: (task: TaskEnvelope) => void;
    },
  ): Promise<void> {
    const response = await deps.transport.subscribe(taskId, options);
    if (!response.body) {
      throw new Error('A2A SSE response missing body');
    }
    await sseBridge.consumeStream(response.body, (event) => {
      if (event.taskId !== taskId) return;
      const updated = sync.applyEvent(event);
      handler(updated);
    });

    if (options?.autoSyncOnEnd !== false) {
      const snapshot = await syncTask(taskId);
      if (options?.onSync) {
        options.onSync(snapshot);
      } else {
        handler(snapshot);
      }
    }
  }

  return { startTask, syncTask, subscribeTask };
}
