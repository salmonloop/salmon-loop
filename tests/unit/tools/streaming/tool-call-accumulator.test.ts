import { describe, expect, it } from 'vitest';

import { ToolCallAccumulator } from '../../../../src/core/tools/streaming/ToolCallAccumulator.js';

describe('ToolCallAccumulator', () => {
  it('aggregates tool calls across chunks and drains them once', () => {
    const acc = new ToolCallAccumulator();
    acc.append({ role: 'assistant', tool_calls: [{ id: 'one' }] });
    acc.append({ role: 'assistant', tool_calls: [{ id: 'two' }] });

    expect(acc.drain()).toEqual([{ id: 'one' }, { id: 'two' }]);
    expect(acc.hasAccumulated()).toBe(false);
  });

  it('ignores chunks without tool_calls', () => {
    const acc = new ToolCallAccumulator();
    acc.append({ role: 'assistant', contentDelta: 'text' });
    expect(acc.drain()).toEqual([]);
    expect(acc.hasAccumulated()).toBe(false);
  });
});
