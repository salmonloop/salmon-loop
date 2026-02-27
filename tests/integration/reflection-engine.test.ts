import path from 'node:path';

import { describe, test, expect, beforeEach } from 'bun:test';

import { mkdir, rm, readFile, readdir } from '../../src/core/adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../src/core/config/paths.js';
import { StubLLM } from '../../src/core/llm/index.js';
import { ReflectionEngine } from '../../src/core/reflection/engine.js';
import { LLMMessage } from '../../src/core/types/index.js';
import { safeJoin } from '../../src/core/utils/path.js';

class ReflectionStubLLM extends StubLLM {
  async chat(messages: LLMMessage[]): Promise<LLMMessage> {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.content.includes('Reflection Engine')) {
      return {
        role: 'assistant',
        content: JSON.stringify({
          lessons: ['Always check target environment constraints.'],
          suggestedRules: ['Use named exports only.'],
          suggestedDecisions: ['Record initial failures.'],
        }),
      };
    }
    return super.chat(messages);
  }
}

describe('Reflection Engine Integration', () => {
  const testRepo = path.join(process.cwd(), 'tests/tmp/reflection-test');

  beforeEach(async () => {
    await rm(testRepo, { recursive: true, force: true });
    await mkdir(testRepo, { recursive: true });
  });

  test('should analyze history and persist knowledge', async () => {
    const llm = new ReflectionStubLLM();
    const engine = new ReflectionEngine(llm);

    const input = {
      instruction: 'add export',
      metadata: {
        packageJson: { dependencies: { typescript: '^5.0.0' } },
      },
      history: [
        {
          attempt: 1,
          error: 'SyntaxError: Export declarations are not supported',
          plan: { goal: 'test' },
          patch: '',
          contextSummary: '',
        },
        { attempt: 2, error: undefined, plan: { goal: 'success' }, patch: '', contextSummary: '' },
      ],
      success: true,
    };

    await engine.reflect(input as any, testRepo);

    const indexPath = getDefaultIndexPath(testRepo);
    const knowledgeDir = safeJoin(indexPath, 'knowledge');

    // Check if project rules were updated
    const files = await readdir(knowledgeDir);
    const ruleFile = files.find((f) => f.includes('project_rules'));
    expect(ruleFile).toBeDefined();

    const ruleContent = await readFile(safeJoin(knowledgeDir, ruleFile!), 'utf-8');
    expect(JSON.parse(ruleContent).project_rules).toContain('Use named exports only.');

    // Check if architectural decisions were updated
    const decisionFile = files.find((f) => f.includes('architectural_decisions'));
    expect(decisionFile).toBeDefined();
    const decisionContent = await readFile(safeJoin(knowledgeDir, decisionFile!), 'utf-8');
    expect(decisionContent).toContain('Record initial failures.');
  });
});
