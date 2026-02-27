import path from 'node:path';

import { describe, test, expect, beforeEach } from 'bun:test';

import { mkdir, writeFile, rm } from '../../src/core/adapters/fs/node-fs.js';
import { buildContextPromotionStep } from '../../src/core/context/steps/context-promotion.js';
import { ContextTargetsCtx } from '../../src/core/context/steps/types.js';

describe('ContextPromotionStep', () => {
  const testRepo = path.join(process.cwd(), 'tests/tmp/promotion-test');

  beforeEach(async () => {
    await rm(testRepo, { recursive: true, force: true });
    await mkdir(testRepo, { recursive: true });
  });

  test('should promote high-relevance outline files to full content', async () => {
    const importantFile = 'src/important.ts';
    const importantContent = 'export const data = "VERY IMPORTANT";';
    await mkdir(path.dirname(path.join(testRepo, importantFile)), { recursive: true });
    await writeFile(path.join(testRepo, importantFile), importantContent);

    const mockCtx: ContextTargetsCtx = {
      req: {
        repoPath: testRepo,
        instruction: 'use important data', // Matches 'important' keyword
        primaryFile: 'src/main.ts',
        signal: new AbortController().signal,
      },
      diffScope: 'primary',
      primaryText: 'import { data } from "./important";',
      relatedFiles: [
        {
          path: importantFile,
          content: '// Outline of important.ts',
          kind: 'import',
          mode: 'outline',
        },
      ],
      rgSnippets: [],
      targets: [],
      includedFiles: [],
      stagedDiff: undefined,
      unstagedDiff: undefined,
      gitDiff: undefined,
      symbols: [],
      definitionMap: {},
      analysis: undefined,
      projectMetadata: undefined,
      gitHistory: undefined,
      projectTopology: undefined,
      knowledgeBase: undefined,
      runtimeArtifacts: undefined,
    };

    const step = buildContextPromotionStep({} as any);
    const result = await step(mockCtx);

    const promoted = result.relatedFiles?.find((f) => f.path === importantFile);
    expect(promoted?.mode).toBe('full');
    expect(promoted?.content).toBe(importantContent);
  });
});
