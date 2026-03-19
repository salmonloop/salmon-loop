import { z } from 'zod';

import {
  clearPromptRegistry,
  createPromptRegistry,
  setPromptRegistry,
} from '../../../src/core/prompts/registry.js';
import {
  getExploreSystemPrompt,
  getPatchSystemPrompt,
  getPlanSystemPrompt,
} from '../../../src/core/prompts/runtime.js';
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

    const output = await getExploreSystemPrompt({
      plan: { sessionId: 'sess', planPathHint: 'plan.md' },
    });

    expect(output).toContain('You are in EXPLORE.');
    expect(output).not.toContain('## Available Tools');
    expect(output).not.toContain('## Knowledge Retention');
    expect(output).not.toContain('code.read');
    expect(output).not.toContain('fs.list_directory');
    expect(output).not.toContain('legacy name');
  });

  it('exposes plan.read and plan.update only when runtime.plan exists', async () => {
    const registry = new ToolRegistry();

    registerTool(registry, {
      name: 'plan.init',
      source: 'builtin',
      intent: 'WRITE',
      description: 'Initialize runtime plan',
      riskLevel: 'low',
      sideEffects: ['runtime_write'],
      concurrency: 'serial_only',
      allowedPhases: ['PLAN'],
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    });

    registerTool(registry, {
      name: 'plan.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read runtime plan',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['PLAN'],
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    });

    registerTool(registry, {
      name: 'plan.update',
      source: 'builtin',
      intent: 'WRITE',
      description: 'Update runtime plan',
      riskLevel: 'low',
      sideEffects: ['runtime_write'],
      concurrency: 'serial_only',
      allowedPhases: ['PLAN'],
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    });

    const withRuntime = await getPlanSystemPrompt(registry, {
      plan: { sessionId: 'sess', planPathHint: '.salmonloop/plans/sess/plan.md' },
    });

    expect(withRuntime).toContain('### plan.read');
    expect(withRuntime).toContain('### plan.update');
    expect(withRuntime).not.toContain('### plan.init');

    const withoutRuntime = await getPlanSystemPrompt(registry);
    expect(withoutRuntime).not.toContain('### plan.read');
    expect(withoutRuntime).not.toContain('### plan.update');
    expect(withoutRuntime).not.toContain('### plan.init');
  });

  it('limits patch prompt-visible tools to the minimal read-only set', async () => {
    const registry = new ToolRegistry();

    registerTool(registry, {
      name: 'fs.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read files',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['PATCH'],
      inputSchema: z.object({ file: z.string() }),
      outputSchema: z.object({ content: z.string() }),
    });

    registerTool(registry, {
      name: 'code.search',
      source: 'builtin',
      intent: 'SEARCH',
      description: 'Search code',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['PATCH'],
      inputSchema: z.object({ pattern: z.string() }),
      outputSchema: z.object({ matches: z.array(z.any()) }),
    });

    registerTool(registry, {
      name: 'fs.list',
      source: 'builtin',
      intent: 'LIST',
      description: 'List files',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['PATCH'],
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.object({ entries: z.array(z.any()) }),
    });

    registerTool(registry, {
      name: 'plan.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read runtime plan',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['PATCH'],
      inputSchema: z.object({ sessionId: z.string() }),
      outputSchema: z.object({ baseHash: z.string() }),
    });

    const output = await getPatchSystemPrompt(registry, {
      plan: { sessionId: 'sess', planPathHint: '.salmonloop/plans/sess/plan.md' },
    });

    expect(output).toContain('### fs.read');
    expect(output).toContain('### code.search');
    expect(output).not.toContain('### fs.list');
    expect(output).not.toContain('### plan.read');
  });
});
