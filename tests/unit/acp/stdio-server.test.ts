import { describe, expect, it } from 'bun:test';

import { createAcpStdioStream } from '../../../src/core/protocols/acp/stdio-server.js';

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
