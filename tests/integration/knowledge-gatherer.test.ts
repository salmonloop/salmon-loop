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

  test('should read project rules from aggregated knowledge files', async () => {
    const indexPath = getDefaultIndexPath(testRepo);
    const knowledgeDir = safeJoin(indexPath, 'knowledge');
    await mkdir(knowledgeDir, { recursive: true });

    // Simulate two rule update events
    await writeFile(
      safeJoin(knowledgeDir, '100-project_rules.json'),
      JSON.stringify({ project_rules: ['Old Rule'] }),
    );
    await writeFile(
      safeJoin(knowledgeDir, '200-project_rules.json'),
      JSON.stringify({ project_rules: ['New Rule'] }),
    );

    const gatherer = new KnowledgeGatherer();
    const result = await gatherer.gather(mockReq);

    // Last-Writer-Wins
    expect(result.project_rules).toContain('New Rule');
    expect(result.project_rules).not.toContain('Old Rule');
  });

  test('should return empty knowledge if directory does not exist', async () => {
    const gatherer = new KnowledgeGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result).toBeDefined();
    expect(result.project_rules).toBeUndefined();
  });
});
