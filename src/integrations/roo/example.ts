import { FakeLLM } from '../../core/llm.js';

import { RooSalmonAdapter } from './adapter.js';

export const example = async () => {
  const adapter = new RooSalmonAdapter();

  const fakeLLM = new FakeLLM(
    [
      {
        goal: 'Fix bug',
        files: ['src/index.ts'],
        changes: ['Update version'],
        verify: 'npm test',
      },
    ],
    ['diff --git a/src/index.ts b/src/index.ts\n...'],
  );

  const result = await adapter.execute({
    instruction: 'Fix the bug in index.ts',
    verify: 'npm test',
    repoPath: process.cwd(),
    llm: fakeLLM,
    allowDirty: false,
  });

  console.log('Result:', result.success);
};
