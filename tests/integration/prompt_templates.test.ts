import { z } from 'zod';

import {
  clearPromptRegistry,
  createPromptRegistry,
  setPromptRegistry,
} from '../../src/core/prompts/registry.js';
import {
  getAnswerSystemPrompt,
  getAutopilotSystemPrompt,
  getPatchPrompt,
  getPatchSystemPrompt,
  getPlanPrompt,
  getPlanSystemPrompt,
  getResearchPrompt,
  getResearchSystemPrompt,
  getReviewPrompt,
} from '../../src/core/prompts/runtime.js';
import { ToolRegistry } from '../../src/core/tools/registry.js';

describe('Prompt templates', () => {
  beforeEach(() => {
    setPromptRegistry(createPromptRegistry());
  });

  afterEach(() => {
    clearPromptRegistry();
  });

  it('renders system prompts from templates', async () => {
    const planSystem = await getPlanSystemPrompt();
    const patchSystem = await getPatchSystemPrompt();
    const autopilotSystem = await getAutopilotSystemPrompt();
    const answerSystem = await getAnswerSystemPrompt();
    const researchSystem = await getResearchSystemPrompt();

    expect(planSystem).toContain('You are SalmonLoop.');
    expect(patchSystem).toContain('You are PATCH, a phase-native diff compiler.');
    expect(autopilotSystem).toContain('You are a coding assistant running in "autopilot" mode.');
    expect(answerSystem).toContain('You are a coding assistant in "answer" mode.');
    expect(researchSystem).toContain('You are a research assistant.');
  });

  it('renders plan and patch prompts without HTML escaping', async () => {
    const context = ['# Context Data', 'Example code:', 'if (a < b) {', '  return a;', '}'].join(
      '\n',
    );

    const instruction = 'Update the example to return b when b is smaller.';
    const lastError = 'Previous attempt failed: expected a < b to remain unescaped.';

    const planPrompt = await getPlanPrompt(context, instruction, 3, lastError);
    expect(planPrompt).toContain('if (a < b) {');
    expect(planPrompt).not.toContain('&lt;');

    const plan = JSON.stringify(
      {
        goal: 'Example change',
        files: ['src/example.ts'],
        changes: ['Update example'],
        verify: 'npm test',
      },
      null,
      2,
    );

    const patchPrompt = await getPatchPrompt(plan, context, 3, 200, lastError);
    expect(patchPrompt).toContain('# Target Files');
    expect(patchPrompt).toContain('src/example.ts');
    expect(patchPrompt).toContain('if (a < b) {');
    expect(patchPrompt).not.toContain('&lt;');
    expect(patchPrompt).not.toContain('8-12 lines');
    expect(patchPrompt).not.toContain('No file creation');
    expect(patchPrompt).not.toContain('DO NOT include `index');
  });

  it('renders PLAN/PATCH system prompts with phase-filtered tool surfaces', async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: 'fs.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read files',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['PLAN', 'PATCH'],
      inputSchema: z.object({ file: z.string() }),
      outputSchema: z.object({ content: z.string() }),
      executor: async () => ({}),
    });
    tools.register({
      name: 'code.search',
      source: 'builtin',
      intent: 'SEARCH',
      description: 'Search code',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['PLAN', 'PATCH'],
      inputSchema: z.object({ pattern: z.string() }),
      outputSchema: z.object({ matches: z.array(z.any()) }),
      executor: async () => ({}),
    });
    tools.register({
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
      executor: async () => ({}),
    });
    tools.register({
      name: 'plan.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read runtime plan',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: ['PLAN', 'PATCH'],
      inputSchema: z.object({ sessionId: z.string() }),
      outputSchema: z.object({ baseHash: z.string() }),
      executor: async () => ({}),
    });
    tools.register({
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
      executor: async () => ({}),
    });
    tools.register({
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
      executor: async () => ({}),
    });

    const planSystem = await getPlanSystemPrompt(tools, {
      plan: { sessionId: 'sess', planPathHint: '.salmonloop/plans/sess/plan.md' },
    });
    expect(planSystem).toContain('### plan.read');
    expect(planSystem).toContain('### plan.update');
    expect(planSystem).not.toContain('### plan.init');

    const patchSystem = await getPatchSystemPrompt(tools, {
      plan: { sessionId: 'sess', planPathHint: '.salmonloop/plans/sess/plan.md' },
    });
    expect(patchSystem).toContain('### fs.read');
    expect(patchSystem).toContain('### code.search');
    expect(patchSystem).not.toContain('### fs.list');
    expect(patchSystem).not.toContain('### plan.read');
    expect(patchSystem).not.toContain('### plan.update');
  });

  it('renders research and review prompts without HTML escaping', async () => {
    const researchPrompt = await getResearchPrompt('if (a < b) {\n  return a;\n}', 'review logic');
    expect(researchPrompt).toContain('if (a < b) {');
    expect(researchPrompt).not.toContain('&lt;');

    const reviewPrompt = await getReviewPrompt('{"summary":"a < b"}');
    expect(reviewPrompt).toContain('{"summary":"a < b"}');
    expect(reviewPrompt).not.toContain('&lt;');
  });
});
