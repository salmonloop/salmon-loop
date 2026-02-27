import { describe, test, expect, spyOn } from 'bun:test';

import { GhostDependencyGatherer } from '../../../src/core/context/gatherers/ghost-dependency-gatherer.js';
import { RipgrepGatherer } from '../../../src/core/context/gatherers/ripgrep-gatherer.js';
import { ContextRequest } from '../../../src/core/context/types.js';

describe('GhostDependencyGatherer', () => {
  const mockReq: ContextRequest = {
    repoPath: '/repo',
    primaryFile: 'src/Emitter.ts',
    instruction: 'Fix events',
  };

  test('should identify files sharing significant tokens', async () => {
    const ripgrep = new RipgrepGatherer();
    // Mock ripgrep search to return a hit in a listener file
    spyOn(ripgrep, 'searchMultipleKeywords').mockImplementation(async () => [
      { file: 'src/Listener.ts', line: 10, content: 'on("USER_LOGOUT_EVENT")' },
    ]);

    const gatherer = new GhostDependencyGatherer(ripgrep);
    const primaryText = 'emit("USER_LOGOUT_EVENT")';

    const result = await gatherer.gather(primaryText, mockReq, new Set());

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/Listener.ts');
    expect(result[0].content).toContain('USER_LOGOUT_EVENT');
  });

  test('should skip already existing files', async () => {
    const ripgrep = new RipgrepGatherer();
    spyOn(ripgrep, 'searchMultipleKeywords').mockImplementation(async () => [
      { file: 'src/Existing.ts', line: 1, content: 'SomeToken' },
    ]);

    const gatherer = new GhostDependencyGatherer(ripgrep);
    const primaryText = 'SomeToken';

    const result = await gatherer.gather(primaryText, mockReq, new Set(['src/Existing.ts']));

    expect(result).toHaveLength(0);
  });
});
