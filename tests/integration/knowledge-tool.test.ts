import path from 'node:path';

import { describe, test, expect, beforeEach } from 'bun:test';

import { mkdir, rm, readFile } from '../../src/core/adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../src/core/config/paths.js';
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

  test('should set project rules (full replacement)', async () => {
    const rules = ['Rule 1', 'Rule 2'];
    await executeUpdateKnowledge({ category: 'project_rules', rules }, mockCtx);

    const indexPath = getDefaultIndexPath(testRepo);
    const content = await readFile(safeJoin(indexPath, 'knowledge.json'), 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.project_rules).toEqual(rules);
  });

  test('should add architectural decision (incremental append)', async () => {
    await executeUpdateKnowledge(
      {
        category: 'architectural_decisions',
        decision: 'Initial decision',
      },
      mockCtx,
    );

    await executeUpdateKnowledge(
      {
        category: 'architectural_decisions',
        decision: 'Second decision',
      },
      mockCtx,
    );

    const indexPath = getDefaultIndexPath(testRepo);
    const content = await readFile(safeJoin(indexPath, 'knowledge.json'), 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.architectural_decisions).toHaveLength(2);
    expect(parsed.architectural_decisions[0].decision).toBe('Initial decision');
    expect(parsed.architectural_decisions[1].decision).toBe('Second decision');
  });

  test('should set user preferences (replacement)', async () => {
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

    const indexPath = getDefaultIndexPath(testRepo);
    const content = await readFile(safeJoin(indexPath, 'knowledge.json'), 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.user_preferences).toBe('Updated preference');
  });
});
