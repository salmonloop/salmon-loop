import { FakeLLM } from '../../core/llm/index.js';
import { logger } from '../../core/observability/logger.js';

import { RooSalmonAdapter } from './adapter.js';

export const example = async () => {
  const adapter = new RooSalmonAdapter();

  const fakeLLM = new FakeLLM(
    [
      {
        goal: 'Fix bug',
        files: ['src/index.ts'],
        changes: ['Update version'],
        verify: 'project-test-command',
      },
    ],
    ['diff --git a/src/index.ts b/src/index.ts\n...'],
  );

  const result = await adapter.execute({
    instruction: 'Fix the bug in index.ts',
    verify: 'project-test-command',
    repoPath: process.cwd(),
    llm: fakeLLM,
  });

  logger.info(`Result: ${result.success}`);
};
