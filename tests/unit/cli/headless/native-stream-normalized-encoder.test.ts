import { describe, expect, it } from 'vitest';

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
