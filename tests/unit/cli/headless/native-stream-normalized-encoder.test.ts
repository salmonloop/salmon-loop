import { describe, expect, it } from 'bun:test';

import { encodeNormalizedToNativeStreamLines } from '../../../../src/cli/headless/native-stream-normalized-encoder.js';
import type { NormalizedStreamEvent } from '../../../../src/core/streaming/normalized-events.js';

describe('encodeNormalizedToNativeStreamLines', () => {
  it('redacts tool input by default', () => {
    const uuid = (() => {
      let i = 0;
      return () => `u-${++i}`;
    })();

    const lines = encodeNormalizedToNativeStreamLines({
      sessionId: 'sess-1',
      uuid,
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

    expect(lines[1]?.event).toMatchObject({
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        id: 'call-1',
        name: 'fs.readFile',
        input: {},
      },
    });
  });

  it('emits provided redacted tool input when explicitly enabled', () => {
    const uuid = (() => {
      let i = 0;
      return () => `u-${++i}`;
    })();

    const lines = encodeNormalizedToNativeStreamLines({
      sessionId: 'sess-1',
      uuid,
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

    expect(lines[1]?.event).toMatchObject({
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        id: 'call-1',
        name: 'agent_dispatch',
        input: { agent_ref: 'reviewer', task: 'Inspect the patch.' },
      },
    });
  });

  it('includes tool output summary when present', () => {
    const uuid = (() => {
      let i = 0;
      return () => `u-${++i}`;
    })();

    const lines = encodeNormalizedToNativeStreamLines({
      sessionId: 'sess-1',
      uuid,
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

    const content = (lines[1]?.event as any)?.content_block?.content as string;
    expect(content).toContain('output_summary={"ok":true}');
  });
});
