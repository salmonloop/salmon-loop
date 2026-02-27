import path from 'node:path';

import { describe, test, expect, beforeEach } from 'bun:test';

import { mkdir, rm } from '../../src/core/adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../src/core/config/paths.js';
import { KnowledgeGatherer } from '../../src/core/context/gatherers/knowledge-gatherer.js';
import { StubLLM } from '../../src/core/llm/index.js';
import { ReflectionEngine } from '../../src/core/reflection/engine.js';
import { LLMMessage } from '../../src/core/types/index.js';
import { safeJoin } from '../../src/core/utils/path.js';

class ConsistencyStubLLM extends StubLLM {
  async chat(_messages: LLMMessage[]): Promise<LLMMessage> {
    return {
      role: 'assistant',
      content: JSON.stringify({
        lessons: ['Updated constraint found.'],
        suggestedRules: ['Use strict mode.'],
        deprecatedRules: ['Use lax mode.'],
      }),
    };
  }
}

describe('Knowledge Consistency & Deprecation', () => {
  const testRepo = path.join(process.cwd(), 'tests/tmp/consistency-test');

  beforeEach(async () => {
    await rm(testRepo, { recursive: true, force: true });
    await mkdir(testRepo, { recursive: true });
  });

  test('should deprecate old rules through reflection', async () => {
    const indexPath = getDefaultIndexPath(testRepo);
    const knowledgeDir = safeJoin(indexPath, 'knowledge');
    await mkdir(knowledgeDir, { recursive: true });

    // 1. Setup existing "lax mode" rule
    await KnowledgeGatherer.prototype['compact'](
      knowledgeDir,
      {
        project_rules: ['Use lax mode.'],
      } as any,
      [],
    );

    // 2. Run reflection that deprecates it
    const engine = new ReflectionEngine(new ConsistencyStubLLM());
    await engine.reflect(
      {
        instruction: 'fix types',
        history: [
          { attempt: 1, error: 'too lax', plan: {}, patch: '', contextSummary: '' },
          { attempt: 2, error: undefined, plan: {}, patch: '', contextSummary: '' },
        ],
        success: true,
      } as any,
      testRepo,
    );

    // 3. Verify gathering filters it out
    const gatherer = new KnowledgeGatherer();
    const result = await gatherer.gather({ repoPath: testRepo, instruction: '' });

    expect(result.project_rules).toContain('Use strict mode.');
    expect(result.project_rules).not.toContain('Use lax mode.');
  });
});
