import path from 'node:path';

import { describe, test, expect, beforeEach } from 'bun:test';

import { mkdir, writeFile, rm } from '../../src/core/adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../src/core/config/paths.js';
import { KnowledgeGatherer } from '../../src/core/context/gatherers/knowledge-gatherer.js';
import { ContextRequest } from '../../src/core/context/types.js';
import { safeJoin } from '../../src/core/utils/path.js';

describe('KnowledgeGatherer', () => {
  const testRepo = path.join(process.cwd(), 'tests/tmp/knowledge-test');
  const mockReq: ContextRequest = {
    repoPath: testRepo,
    instruction: 'test knowledge',
  };

  beforeEach(async () => {
    await rm(testRepo, { recursive: true, force: true });
    await mkdir(testRepo, { recursive: true });
  });

  test('should read project rules from knowledge.json', async () => {
    const indexPath = getDefaultIndexPath(testRepo);
    await mkdir(indexPath, { recursive: true });

    const knowledgeData = {
      project_rules: ['Always use TDD'],
      user_preferences: 'Prefers functional style',
    };

    await writeFile(safeJoin(indexPath, 'knowledge.json'), JSON.stringify(knowledgeData));

    const gatherer = new KnowledgeGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result.project_rules).toContain('Always use TDD');
    expect(result.user_preferences).toBe('Prefers functional style');
  });

  test('should return empty knowledge if file does not exist', async () => {
    const gatherer = new KnowledgeGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result).toBeDefined();
    expect(result.project_rules).toBeUndefined();
  });
});
