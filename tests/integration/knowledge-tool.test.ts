import path from 'node:path';

import { describe, test, expect, beforeEach } from 'bun:test';

import { mkdir, rm, readdir } from '../../src/core/adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../src/core/config/paths.js';
import { KnowledgeGatherer } from '../../src/core/context/gatherers/knowledge-gatherer.js';
import { executeUpdateKnowledge } from '../../src/core/tools/builtin/knowledge.js';
import { ToolRuntimeCtx } from '../../src/core/tools/types.js';
import { safeJoin } from '../../src/core/utils/path.js';

describe('Knowledge Tool Integration', () => {
  const testRepo = path.join(process.cwd(), 'tests/tmp/knowledge-tool-test');
  const mockCtx: ToolRuntimeCtx = {
    repoRoot: testRepo,
    sessionId: 'test-session',
    signal: new AbortController().signal,
  } as any;

  beforeEach(async () => {
    await rm(testRepo, { recursive: true, force: true });
    await mkdir(testRepo, { recursive: true });
  });

  test('should set project rules (append-only, last-writer-wins)', async () => {
    const rules1 = ['Always use TypeScript strict mode for new files'];
    const rules2 = ['Use camelCase for variable names', 'Prefer const over let when possible'];

    await executeUpdateKnowledge({ category: 'project_rules', rules: rules1 }, mockCtx);
    // Successive calls should create separate files
    await executeUpdateKnowledge({ category: 'project_rules', rules: rules2 }, mockCtx);

    const indexPath = getDefaultIndexPath(testRepo);
    const knowledgeDir = safeJoin(indexPath, 'knowledge');
    const files = await readdir(knowledgeDir);
    expect(files.length).toBe(2);

    // KnowledgeGatherer should aggregate and pick the latest for rules
    const gatherer = new KnowledgeGatherer();
    const result = await gatherer.gather({ repoPath: testRepo, instruction: '' });
    expect(result.project_rules).toEqual(rules2);
  });

  test('should add architectural decisions (append-only, union)', async () => {
    await executeUpdateKnowledge(
      {
        category: 'architectural_decisions',
        decision: 'Use dependency injection for all service classes',
      },
      mockCtx,
    );

    await executeUpdateKnowledge(
      {
        category: 'architectural_decisions',
        decision: 'Prefer composition over inheritance for components',
      },
      mockCtx,
    );

    const gatherer = new KnowledgeGatherer();
    const result = await gatherer.gather({ repoPath: testRepo, instruction: '' });

    expect(result.architectural_decisions).toHaveLength(2);
    expect(result.architectural_decisions?.[0].decision).toBe(
      'Use dependency injection for all service classes',
    );
    expect(result.architectural_decisions?.[1].decision).toBe(
      'Prefer composition over inheritance for components',
    );
  });

  test('should set user preferences (append-only, replacement)', async () => {
    await executeUpdateKnowledge(
      {
        category: 'user_preferences',
        preferences: 'First preference',
      },
      mockCtx,
    );

    await executeUpdateKnowledge(
      {
        category: 'user_preferences',
        preferences: 'Updated preference',
      },
      mockCtx,
    );

    const gatherer = new KnowledgeGatherer();
    const result = await gatherer.gather({ repoPath: testRepo, instruction: '' });

    expect(result.user_preferences).toBe('Updated preference');
  });
});
