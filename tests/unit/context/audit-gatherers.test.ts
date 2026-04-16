import { describe, test, expect } from 'bun:test';

import { GitHistoryGatherer } from '../../../src/core/context/gatherers/git-history-gatherer.js';
import { MetadataGatherer } from '../../../src/core/context/gatherers/metadata-gatherer.js';
import { ContextRequest } from '../../../src/core/context/types.js';

describe('Context Gatherers (Audit Improvements)', () => {
  const mockReq: ContextRequest = {
    repoPath: process.cwd(),
    instruction: 'test audit',
  };

  test('MetadataGatherer should pick up package.json and README', async () => {
    const gatherer = new MetadataGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result.packageJson).toBeDefined();
    expect(result.packageJson?.name).toBe('salmon-loop');
    expect(result.readmeHeader).toBeDefined();
    expect(result.configFiles).toContain('package.json');
    expect(result.configFiles).toContain('tsconfig.json');
  });

  test('GitHistoryGatherer should return recent commits', async () => {
    const gatherer = new GitHistoryGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result.recentCommits).toBeDefined();
    expect(typeof result.recentCommits).toBe('string');
    // It should have at least one line (the one-line format)
    expect(result.recentCommits?.length).toBeGreaterThan(0);
    expect(result.churnByFile).toBeDefined();
    const weights = Object.values(result.churnByFile ?? {});
    expect(weights.length).toBeGreaterThan(0);
    expect(weights.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });
});
