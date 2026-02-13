import {
  getPatchPrompt,
  getPatchSystemPrompt,
  getPlanPrompt,
  getPlanSystemPrompt,
} from '../../src/core/prompts/runtime.js';

describe('Prompt templates', () => {
  it('renders system prompts from templates', async () => {
    const planSystem = await getPlanSystemPrompt();
    const patchSystem = await getPatchSystemPrompt();

    expect(planSystem).toContain('You are SalmonLoop.');
    expect(patchSystem).toContain('You are SalmonLoop.');
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
  });
});
