import { z } from 'zod';

import { PromptRegistry } from '../../../src/core/prompts/registry.js';
import type { ToolSpec } from '../../../src/core/tools/types.js';

// Note: We avoid mocking fs/promises to validate real template loading and path resolution.

function newRegistry() {
  return new PromptRegistry();
}

describe('PromptRegistry', () => {
  it('should initialize only once and be idempotent', async () => {
    const registry = newRegistry();
    const p1 = registry.init();
    const p2 = registry.init();
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);

    // calling again should still return the same (resolved) promise
    const p3 = registry.init();
    expect(p3).toBe(p1);
    await p3;
  });

  it('should throw when rendering before init (template not loaded)', async () => {
    const registry = newRegistry();
    expect(() => registry['render']('plan_system', {})).toThrowError(
      /Prompt template "plan_system" not found/,
    );
  });

  it('should render plan system template with main system and correct phase instruction', async () => {
    const registry = newRegistry();
    await registry.init();
    const out = registry.renderPlanSystem();

    // From templates/system/main_system.hbs and plan_system.hbs
    expect(out).toContain('You are SalmonLoop.');
    expect(out).toContain('Use tool calls to inspect the repository when needed.');
  });

  it('should render patch system template with main system and correct phase instruction', async () => {
    const registry = newRegistry();
    await registry.init();
    const out = registry.renderPatchSystem();

    expect(out).toContain('You are SalmonLoop.');
    expect(out).toContain('Output only a valid unified diff when patching.');
  });

  it('should register json helper to stringify objects', async () => {
    const registry = newRegistry();
    await registry.init();

    // The current shipped templates do not exercise {{json}}, but we can verify helper availability
    // by compiling a quick inline template through the registry internals using loaded Handlebars context.
    // Since registry does not expose compiling arbitrary templates, we validate indirectly:
    // Render known templates to ensure no error and json helper registration did not break anything.
    expect(() => registry.renderPlanSystem()).not.toThrow();
    expect(() => registry.renderPatchSystem()).not.toThrow();
  });

  it('should render plan user template with provided variables', async () => {
    const registry = newRegistry();
    await registry.init();

    const out = registry.renderPlan({
      context: 'CTX',
      instruction: 'INSTR',
      lastError: 'ERR',
      maxFilesChanged: 3,
    });

    // Spot-check that variables are interpolated into the output
    expect(out).toContain('CTX');
    expect(out).toContain('INSTR');
    expect(out).toContain('ERR');

    // It should request pure JSON plan shape
    expect(out).toContain('The plan must be in JSON format');
  });

  it('should render patch user template with provided variables', async () => {
    const registry = newRegistry();
    await registry.init();

    const out = registry.renderPatch({
      plan: '{"goal":"g"}',
      context: 'CTX2',
      targetFiles: 'a.ts\nb.ts',
      lastError: 'E2',
      maxFilesChanged: 2,
      maxDiffLines: 500,
    });

    expect(out).toContain('CTX2');
    expect(out).toContain('a.ts');
    expect(out).toContain('b.ts');
    expect(out).toContain('E2');

    // Ensure diff formatting requirements appear
    expect(out).toContain('Must generate standard **git unified diff format**');
  });

  it('should throw a descriptive error when rendering a non-existent template after init', async () => {
    const registry = newRegistry();
    await registry.init();
    expect(() => registry['render']('nonexistent', {})).toThrowError(
      /Prompt template "nonexistent" not found/,
    );
  });

  it('should load Handlebars partials and compose main_system with tool_defs', async () => {
    const registry = newRegistry();
    await registry.init();
    const out = registry.renderPlanSystem();

    // main_system.hbs includes {{> tool_defs}} which currently renders an empty comment.
    // Validate composition by ensuring main_system content appears once.
    expect(out).toContain('You are SalmonLoop.');
  });

  it('should read templates relative to module directory (path resolution works)', async () => {
    const registry = newRegistry();
    await registry.init();

    // If path resolution is wrong, init would have failed or render would throw.
    expect(() => registry.renderPlanSystem()).not.toThrow();
    expect(() => registry.renderPatchSystem()).not.toThrow();
  });

  describe('Tool Injection', () => {
    it('should inject tool definitions into plan system prompt', async () => {
      const registry = newRegistry();
      await registry.init();

      const mockTool: ToolSpec = {
        name: 'test.search',
        source: 'builtin',
        description: 'Search for test patterns',
        riskLevel: 'low',
        sideEffects: ['fs_read'],
        concurrency: 'parallel_ok',
        allowedPhases: ['PLAN', 'PATCH'],
        defaultTimeoutMs: 5000,
        inputSchema: z.object({ query: z.string() }),
        outputSchema: z.object({ results: z.array(z.string()) }),
        executor: async () => ({ results: [] }),
      };

      registry.setTools([mockTool]);
      const output = registry.renderPlanSystem();

      // Verify tool appears in output
      expect(output).toContain('test.search');
      expect(output).toContain('Search for test patterns');
      expect(output).toContain('builtin');
      expect(output).toContain('low');
      expect(output).toContain('fs_read');
    });

    it('should inject tool definitions into patch system prompt', async () => {
      const registry = newRegistry();
      await registry.init();

      const mockTool: ToolSpec = {
        name: 'code.read',
        source: 'builtin',
        description: 'Read source code files',
        riskLevel: 'low',
        sideEffects: ['fs_read'],
        concurrency: 'parallel_ok',
        allowedPhases: ['PLAN', 'PATCH'],
        inputSchema: z.object({ path: z.string() }),
        outputSchema: z.object({ content: z.string() }),
        executor: async () => ({ content: '' }),
      };

      registry.setTools([mockTool]);
      const output = registry.renderPatchSystem();

      expect(output).toContain('code.read');
      expect(output).toContain('Read source code files');
    });

    it('should render multiple tools correctly', async () => {
      const registry = newRegistry();
      await registry.init();

      const tools: ToolSpec[] = [
        {
          name: 'tool.one',
          source: 'builtin',
          description: 'First tool',
          riskLevel: 'low',
          sideEffects: ['none'],
          concurrency: 'parallel_ok',
          allowedPhases: ['PLAN'],
          inputSchema: z.object({}),
          outputSchema: z.object({}),
          executor: async () => ({}),
        },
        {
          name: 'tool.two',
          source: 'mcp',
          description: 'Second tool',
          riskLevel: 'high',
          sideEffects: ['fs_write', 'git_write'],
          concurrency: 'serial_only',
          allowedPhases: ['PATCH'],
          inputSchema: z.object({}),
          outputSchema: z.object({}),
          executor: async () => ({}),
        },
      ];

      registry.setTools(tools);
      const output = registry.renderPlanSystem();

      expect(output).toContain('tool.one');
      expect(output).toContain('tool.two');
      expect(output).toContain('First tool');
      expect(output).toContain('Second tool');
      expect(output).toContain('mcp');
    });

    it('should handle empty tool list gracefully', async () => {
      const registry = newRegistry();
      await registry.init();

      registry.setTools([]);
      const output = registry.renderPlanSystem();

      // Should still render the system prompt
      expect(output).toContain('You are SalmonLoop.');
      // Should not crash
      expect(output).toBeDefined();
    });

    it('should include tool usage guidelines when tools are present', async () => {
      const registry = newRegistry();
      await registry.init();

      const mockTool: ToolSpec = {
        name: 'test.tool',
        source: 'builtin',
        description: 'Test tool',
        riskLevel: 'medium',
        sideEffects: ['network'],
        concurrency: 'parallel_ok',
        allowedPhases: ['PLAN'],
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        executor: async () => ({}),
      };

      registry.setTools([mockTool]);
      const output = registry.renderPlanSystem();

      expect(output).toContain('Available Tools');
      expect(output).toContain('Tool Usage Guidelines');
    });
  });
});
