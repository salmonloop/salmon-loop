import { z } from 'zod';

import { registerAllBuiltins } from '../../../src/core/tools/builtin/index.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import type { ToolSpec } from '../../../src/core/tools/types.js';
import { Phase } from '../../../src/core/types/index.js';

describe('ToolRegistry intent contract', () => {
  it('rejects tool specs without a declared intent', () => {
    const registry = new ToolRegistry();

    const missingIntent = {
      name: 'test.missing_intent',
      source: 'builtin',
      description: 'missing intent',
      riskLevel: 'low',
      sideEffects: ['none'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      executor: async () => ({}),
    } as unknown as ToolSpec;

    expect(() => registry.register(missingIntent)).toThrow('must declare a valid intent');
  });

  it('registers all builtin tools with explicit intents', () => {
    const registry = new ToolRegistry();
    registerAllBuiltins(registry);

    const allTools = registry.listAll();
    expect(allTools.length).toBeGreaterThan(0);
    expect(
      allTools.every((spec) => typeof spec.intent === 'string' && spec.intent.length > 0),
    ).toBe(true);
  });
});
