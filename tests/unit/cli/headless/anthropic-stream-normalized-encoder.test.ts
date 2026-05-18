import { describe, expect, it } from 'bun:test';

import { encodeNormalizedToAnthropicStreamLines } from '../../../../src/cli/headless/anthropic-stream-normalized-encoder.js';
import type { NormalizedStreamEvent } from '../../../../src/core/streaming/normalized-events.js';

describe('encodeNormalizedToAnthropicStreamLines', () => {
  it('redacts tool input by default', () => {
    const lines = encodeNormalizedToAnthropicStreamLines({
      sessionId: 'sess-1',
      event: {
        type: 'normalized.tool_request_start',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        input: { file: 'secret.txt' },
        timestamp: new Date('2026-02-20T00:00:01.000Z'),
      } satisfies NormalizedStreamEvent,
    });

    expect(lines[1]).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'call-1',
          name: 'fs.readFile',
          input: {},
        },
      },
    });
  });

  it('emits provided redacted tool input when explicitly enabled', () => {
    const lines = encodeNormalizedToAnthropicStreamLines({
      sessionId: 'sess-1',
      includeToolInput: true,
      event: {
        type: 'normalized.tool_request_start',
        callId: 'call-1',
        toolName: 'agent_dispatch',
        phase: 'PATCH',
        round: 1,
        input: { agent_ref: 'reviewer', task: 'Inspect the patch.' },
        timestamp: new Date('2026-02-20T00:00:01.000Z'),
      } satisfies NormalizedStreamEvent,
    });

    expect(lines[1]).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'call-1',
          name: 'agent_dispatch',
          input: { agent_ref: 'reviewer', task: 'Inspect the patch.' },
        },
      },
    });
  });

  it('includes tool output summary when present', () => {
    const lines = encodeNormalizedToAnthropicStreamLines({
      sessionId: 'sess-1',
      event: {
        type: 'normalized.tool_call_end',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        status: 'ok',
        outputSummary: '{"ok":true}',
        timestamp: new Date('2026-02-20T00:00:02.000Z'),
      } satisfies NormalizedStreamEvent,
    });

    const content = (lines[1] as any).event.content_block.content as string;
    expect(content).toContain('output_summary={"ok":true}');
  });
});
