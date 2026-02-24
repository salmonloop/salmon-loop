import { describe, expect, it } from 'bun:test';

import {
  decodeSseEvents,
  isEventStreamResponse,
} from '../../../../../src/core/tools/mcp/streamable-http.js';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('streamable-http', () => {
  it('detects event-stream responses', async () => {
    const response = new Response('ok', {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
    expect(isEventStreamResponse(response)).toBe(true);
  });

  it('decodes SSE events with chunk boundaries', async () => {
    const body = sseStream([
      'id: 1\n',
      'event: message\n',
      'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n',
      '\n',
    ]);

    const events: any[] = [];
    for await (const evt of decodeSseEvents(body)) events.push(evt);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('1');
    expect(events[0].event).toBe('message');
    expect(events[0].data).toContain('"result"');
  });
});
