import { z } from 'zod';

import {
  clearPromptRegistry,
  createPromptRegistry,
  setPromptRegistry,
} from '../../../src/core/prompts/registry.js';
import { getExploreSystemPrompt } from '../../../src/core/prompts/runtime.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import type { ToolSpec } from '../../../src/core/tools/types.js';

function registerTool(registry: ToolRegistry, spec: Omit<ToolSpec, 'executor'>): void {
  registry.register({
    ...spec,
    executor: async () => ({}),
  });
}

describe('prompt runtime', () => {
  beforeEach(() => {
    setPromptRegistry(createPromptRegistry());
  });

  afterEach(() => {
    clearPromptRegistry();
  });

  it('does not expose generic tool appendix or alias strings in explore system prompt', async () => {
    const registry = new ToolRegistry();

    registerTool(registry, {
      name: 'code.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read source code files',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['EXPLORE'],
      inputSchema: z.object({ file: z.string() }),
      outputSchema: z.object({ content: z.string() }),
    });

    registerTool(registry, {
      name: 'fs.list_directory',
      source: 'builtin',
      intent: 'LIST',
      description:
        'List directory entries under a repository path (legacy name). Prefer fs.list_directory for clarity.',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['EXPLORE'],
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.object({ entries: z.array(z.string()) }),
    });

    const output = await getExploreSystemPrompt(registry, {
      plan: { sessionId: 'sess', planPathHint: 'plan.md' },
    });

    expect(output).toContain('You are in EXPLORE.');
    expect(output).not.toContain('## Available Tools');
    expect(output).not.toContain('## Knowledge Retention');
    expect(output).not.toContain('code.read');
    expect(output).not.toContain('fs.list_directory');
    expect(output).not.toContain('legacy name');
  });
});
