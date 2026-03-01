import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'stream';

import { createAcpJsonRpcHandler } from '../../../src/core/protocols/acp/jsonrpc.js';
import { createAcpStdioLoop } from '../../../src/core/transports/stdio/acp-stdio-loop.js';

function createEventBus() {
  const listeners = new Set<(event: any) => void>();
  return {
    subscribe(listener: (event: any) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(event: any) {
      for (const listener of listeners) listener(event);
    },
    list() {
      return [];
    },
  };
}

function waitFor(condition: () => boolean, timeoutMs = 2000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for condition'));
      }
    }, 10);
  });
}

describe('ACP stdio stream', () => {
  it('streams session/update notifications', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const errorOutput = new PassThrough();

    const lines: any[] = [];
    let buffer = '';
    output.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        if (!part.trim()) continue;
        lines.push(JSON.parse(part));
      }
    });

    const eventBus = createEventBus();
    let taskCounter = 0;

    const handler = createAcpJsonRpcHandler({
      agentInfo: { name: 'salmon-loop', version: '0.2.0' },
      eventBus,
      emitNotification: async (note) => {
        output.write(`${JSON.stringify(note)}\n`);
      },
      facade: {
        createTask: async () => {
          taskCounter += 1;
          return {
            id: `task_${taskCounter}`,
            state: 'accepted',
            capability: 'patch',
            request: { instruction: 'hi' },
          } as any;
        },
        getTask: async () => null,
        cancelTask: async () => null,
        resumeTask: async () => null,
        retryTask: async () => null,
        reopenTask: async () => null,
        listTasks: async () => ({ items: [] }),
        submitInput: async () => null,
        getArtifact: async () => null,
      },
    });

    createAcpStdioLoop({
      input,
      output,
      errorOutput,
      handler,
    });

    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: 1, clientInfo: { name: 'test', version: '0.0.0' }, capabilities: {} },
      })}\n`,
    );

    await waitFor(() => lines.some((line) => line.id === 1));

    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        params: { cwd: '/tmp', mcpServers: [] },
      })}\n`,
    );

    await waitFor(() => lines.some((line) => line.id === 2));
    const sessionResponse = lines.find((line) => line.id === 2);
    const sessionId = sessionResponse?.result?.sessionId as string;

    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: 'Hello' }] },
      })}\n`,
    );

    setTimeout(() => {
      eventBus.publish({ type: 'task.completed', taskId: 'task_1' });
    }, 0);

    await waitFor(() => lines.some((line) => line.method === 'session/update'));

    const updates = lines.filter((line) => line.method === 'session/update');
    expect(updates.length).toBeGreaterThan(0);
  });
});
