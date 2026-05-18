import { AgentSideConnection } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'bun:test';

import { createAcpFormalAgent } from '../../../src/core/protocols/acp/formal-agent.js';
import { createAcpStdioStream } from '../../../src/core/protocols/acp/stdio-server.js';
import { waitForCondition } from '../../helpers/wait-for.js';

function makeInputStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function makeOutputCollector() {
  const chunks: Uint8Array[] = [];
  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });
  const getText = () => new TextDecoder().decode(concatChunks(chunks));
  return { output, getText };
}

function makeWritableInputStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const input = new ReadableStream<Uint8Array>({
    start(createdController) {
      controller = createdController;
    },
  });
  const writeMessage = (message: unknown) => {
    controller.enqueue(encoder.encode(JSON.stringify(message) + '\n'));
  };
  const close = () => controller.close();
  return { input, writeMessage, close };
}

async function drainReadable(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function makeUnusedFacade() {
  return {
    createTask: async () => {
      throw new Error('not used');
    },
    getTask: async () => null,
    cancelTask: async () => null,
    resumeTask: async () => null,
    retryTask: async () => null,
    reopenTask: async () => null,
    listTasks: async () => ({ items: [] }),
    submitInput: async () => null,
    getArtifact: async () => null,
  };
}

async function readJsonLines(getText: () => string) {
  return getText()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForJsonRpcResponse(getText: () => string, id: number) {
  await waitForCondition(
    async () => {
      const lines = await readJsonLines(getText);
      return lines.some((line) => line.id === id);
    },
    { timeoutMs: 1000, intervalMs: 5, description: `ACP response ${id}` },
  );
  const lines = await readJsonLines(getText);
  return lines.find((line) => line.id === id);
}

describe('ACP stdio guard', () => {
  it('returns Invalid Request for non-object JSON', async () => {
    const input = makeInputStream('123\n');
    const { output, getText } = makeOutputCollector();
    const stream = createAcpStdioStream(output, input);

    await drainReadable(stream.readable);

    const lines = getText().trim().split('\n');
    expect(lines).toHaveLength(1);
    const message = JSON.parse(lines[0]);
    expect(message).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    });
  });

  it('returns Parse error for invalid JSON', async () => {
    const input = makeInputStream('text\n');
    const { output, getText } = makeOutputCollector();
    const stream = createAcpStdioStream(output, input);

    await drainReadable(stream.readable);

    const lines = getText().trim().split('\n');
    expect(lines).toHaveLength(1);
    const message = JSON.parse(lines[0]);
    expect(message).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  });

  it('passes through valid JSON-RPC objects', async () => {
    const input = makeInputStream('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    const { output, getText } = makeOutputCollector();
    const stream = createAcpStdioStream(output, input);

    const reader = stream.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(false);
    expect(value).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(getText().trim()).toBe('');
  });

  it('passes through a final valid JSON-RPC object without a trailing newline', async () => {
    const input = makeInputStream('{"jsonrpc":"2.0","id":1,"method":"session/list"}');
    const { output, getText } = makeOutputCollector();
    const stream = createAcpStdioStream(output, input);

    const reader = stream.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(false);
    expect(value).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'session/list', params: {} });
    expect(getText().trim()).toBe('');
  });

  it('returns Parse error for final invalid JSON without a trailing newline', async () => {
    const input = makeInputStream('text');
    const { output, getText } = makeOutputCollector();
    const stream = createAcpStdioStream(output, input);

    await drainReadable(stream.readable);

    const lines = getText().trim().split('\n');
    expect(lines).toHaveLength(1);
    const message = JSON.parse(lines[0]);
    expect(message).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  });

  it('handles session/list when a JSON-RPC client omits params', async () => {
    const { input, writeMessage, close } = makeWritableInputStream();
    const { output, getText } = makeOutputCollector();
    const stream = createAcpStdioStream(output, input);

    new AgentSideConnection(
      (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: 'test' },
          facade: makeUnusedFacade(),
        }),
      stream,
    );

    writeMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    });
    const initialized = await waitForJsonRpcResponse(getText, 1);

    writeMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: { cwd: '/repo', mcpServers: [] },
    });
    const created = await waitForJsonRpcResponse(getText, 2);

    writeMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/list',
    });
    const listed = await waitForJsonRpcResponse(getText, 3);
    close();

    expect(initialized?.result?.agentCapabilities?.sessionCapabilities).toMatchObject({
      list: {},
    });
    expect(typeof created?.result?.sessionId).toBe('string');
    expect(listed?.error).toBeUndefined();
    expect(listed?.result?.sessions).toEqual([
      expect.objectContaining({
        sessionId: created?.result?.sessionId,
        cwd: '/repo',
        title: 'repo',
      }),
    ]);
  });

  it('rejects null, arrays, and strings', async () => {
    const input = makeInputStream('null\n[]\n"text"\n');
    const { output, getText } = makeOutputCollector();
    const stream = createAcpStdioStream(output, input);

    await drainReadable(stream.readable);

    const lines = getText().trim().split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const message = JSON.parse(line);
      expect(message.error?.code).toBe(-32600);
    }
  });
});
