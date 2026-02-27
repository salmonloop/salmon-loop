import { ContextService } from '../../../src/core/context/service.js';
import type { ContextRequest } from '../../../src/core/context/types.js';

describe('ContextService', () => {
  it('builds prompt and context with injected deps', async () => {
    const service = new ContextService({
      primaryTextGatherer: {
        gather: async () => ({ primaryText: 'PRIMARY' }),
      } as any,
      ripgrepGatherer: {
        searchMultipleKeywords: async () => [{ file: 'src/a.ts', line: 1, content: 'SNIP' }],
      } as any,
      gitDiffGatherer: {
        gather: async () => ({
          stagedDiff: 'STAGED',
          unstagedDiff: undefined,
          gitDiff: 'STAGED',
          includedFiles: ['src/a.ts'],
        }),
      } as any,
      astGatherer: {
        gather: async () => ({
          symbols: [],
          definitionMap: {},
          relatedFiles: [],
          repoMap: {
            trigger: 'shallow',
            maxDepth: 1,
            nodes: [{ path: 'src/a.ts', depth: 0, source: 'primary' }],
            edges: [],
          },
          symbolMap: {
            nodes: [
              {
                id: 'def:foo:1:1',
                name: 'foo',
                kind: 'definition',
                path: 'src/a.ts',
                location: { start: { line: 1, column: 1 }, end: { line: 1, column: 4 } },
              },
            ],
            edges: [],
          },
          controlFlow: { branchCount: 1, loopCount: 0, asyncBoundaryCount: 0, hotspots: [] },
          exceptionPaths: { tryCatchCount: 0, throwCount: 0, promiseCatchCount: 0, hotspots: [] },
        }),
      } as any,
      assembler: {
        assemble: () => ({ prompt: 'PROMPT' }),
      },
    });

    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
      budgetChars: 100,
    };

    const result = await service.build(req);
    expect(result.prompt).toBe('PROMPT');
    expect(result.context.primaryText).toBe('PRIMARY');
    expect(result.context.repoMap?.trigger).toBe('shallow');
    expect(result.context.symbolMap?.nodes[0]?.name).toBe('foo');
    expect(result.context.rgSnippets.length).toBe(1);
    expect(result.meta.diffScope).toBe('primary');
    expect(result.meta.includedFiles).toEqual(['src/a.ts']);
    expect(result.meta.usedChars).toBeGreaterThan(0);
    expect(result.meta.budgetAllocation).toBeDefined();
    expect(result.meta.budgetAllocation?.ratio).toEqual({
      primary: 0.6,
      related: 0.3,
      secondary: 0.1,
    });
  });

  it('aborts build when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const service = new ContextService({
      primaryTextGatherer: {
        gather: async () => ({ primaryText: 'PRIMARY' }),
      } as any,
      ripgrepGatherer: {
        searchMultipleKeywords: async () => [{ file: 'src/a.ts', line: 1, content: 'SNIP' }],
      } as any,
      gitDiffGatherer: {
        gather: async () => ({
          stagedDiff: 'STAGED',
          unstagedDiff: undefined,
          gitDiff: 'STAGED',
          includedFiles: ['src/a.ts'],
        }),
      } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: {
        assemble: () => ({ prompt: 'PROMPT' }),
      },
    });

    const req = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
      signal: controller.signal,
    } as any as ContextRequest;

    await expect(service.build(req)).rejects.toThrow(/cancelled by user/i);
  });

  it('preserves requested diffScope in meta', async () => {
    const service = new ContextService({
      primaryTextGatherer: { gather: async () => ({ primaryText: 'PRIMARY' }) } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: [] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: { assemble: () => ({ prompt: 'PROMPT' }) },
    });

    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
      diffScope: 'ast_related',
    };

    const result = await service.build(req);
    expect(result.meta.diffScope).toBe('ast_related');
  });

  it('records workspaceMode in context meta', async () => {
    const service = new ContextService({
      primaryTextGatherer: { gather: async () => ({ primaryText: 'PRIMARY' }) } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: [] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: { assemble: () => ({ prompt: 'PROMPT' }) },
    });

    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
      workspaceMode: 'shadow',
    };

    const result = await service.build(req);
    expect(result.meta.environment?.workspaceMode).toBe('shadow');
  });

  it('invalidates cached context when tracked file signature changes', async () => {
    let assembleCount = 0;
    const service = new ContextService({
      primaryTextGatherer: { gather: async () => ({ primaryText: 'PRIMARY' }) } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: ['src/b.ts'] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: {
        assemble: () => {
          assembleCount += 1;
          return { prompt: `PROMPT-${assembleCount}` };
        },
      },
    });

    const mtimes: Record<string, number> = {
      '/repo/src/a.ts': 10,
      '/repo/src/b.ts': 20,
    };
    (service as any).fileAdapter = {
      readFile: async () => 'same-primary-content',
      stat: async (filePath: string) =>
        ({ mtimeMs: mtimes[filePath] ?? 0, size: 100 }) as { mtimeMs: number; size: number },
    };

    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
    };

    const first = await service.build(req);
    expect(first.prompt).toBe('PROMPT-1');
    expect(assembleCount).toBe(1);

    mtimes['/repo/src/b.ts'] = 99;
    const second = await service.build(req);
    expect(second.prompt).toBe('PROMPT-2');
    expect(assembleCount).toBe(2);
  });

  it('keeps cache when unrelated noise changes but tracked signatures stay stable', async () => {
    let assembleCount = 0;
    const service = new ContextService({
      primaryTextGatherer: { gather: async () => ({ primaryText: 'PRIMARY' }) } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: ['src/a.ts'] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: {
        assemble: () => {
          assembleCount += 1;
          return { prompt: `PROMPT-${assembleCount}` };
        },
      },
    });

    const statsByPath: Record<string, { mtimeMs: number; size: number }> = {
      '/repo/src/a.ts': { mtimeMs: 10, size: 100 },
      '/repo/.git/HEAD': { mtimeMs: 1, size: 32 },
      '/repo/.git/index': { mtimeMs: 1, size: 64 },
      '/repo/noise.log': { mtimeMs: 1, size: 1 },
    };
    (service as any).fileAdapter = {
      stat: async (filePath: string) => statsByPath[filePath] ?? ({ mtimeMs: 0, size: 0 } as any),
    };

    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
    };

    const first = await service.build(req);
    expect(first.prompt).toBe('PROMPT-1');
    statsByPath['/repo/noise.log'] = { mtimeMs: 999, size: 999 };
    const second = await service.build(req);
    expect(second.prompt).toBe('PROMPT-1');
    expect(assembleCount).toBe(1);
  });

  it('isolates cache by snapshot/workspace mode when no explicit target file is provided', async () => {
    let assembleCount = 0;
    const service = new ContextService({
      primaryTextGatherer: { gather: async () => ({ primaryText: undefined }) } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: [] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: {
        assemble: () => {
          assembleCount += 1;
          return { prompt: `PROMPT-${assembleCount}` };
        },
      },
    });

    (service as any).fileAdapter = {
      stat: async () => ({ mtimeMs: 1, size: 1 }),
    };

    const req: ContextRequest = {
      instruction: 'answer only',
      repoPath: '/repo',
      primaryFile: undefined,
    };

    const first = await service.build(req);
    expect(first.prompt).toBe('PROMPT-1');
    const second = await service.build({ ...req, snapshotHash: 'snap-2' });
    expect(second.prompt).toBe('PROMPT-2');
    const third = await service.build({ ...req, snapshotHash: 'snap-2', workspaceMode: 'shadow' });
    expect(third.prompt).toBe('PROMPT-3');
    expect(assembleCount).toBe(3);
  });

  it('invalidates cache for no-primary requests when git state signature changes', async () => {
    let assembleCount = 0;
    const service = new ContextService({
      primaryTextGatherer: { gather: async () => ({ primaryText: undefined }) } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: [] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: {
        assemble: () => {
          assembleCount += 1;
          return { prompt: `PROMPT-${assembleCount}` };
        },
      },
    });

    const statsByPath: Record<string, { mtimeMs: number; size: number }> = {
      '/repo/.git/HEAD': { mtimeMs: 1, size: 32 },
      '/repo/.git/index': { mtimeMs: 1, size: 64 },
    };
    (service as any).fileAdapter = {
      stat: async (filePath: string) => statsByPath[filePath] ?? ({ mtimeMs: 0, size: 0 } as any),
    };

    const req: ContextRequest = {
      instruction: 'answer only',
      repoPath: '/repo',
      primaryFile: undefined,
    };

    const first = await service.build(req);
    expect(first.prompt).toBe('PROMPT-1');
    statsByPath['/repo/.git/index'] = { mtimeMs: 10, size: 80 };
    const second = await service.build(req);
    expect(second.prompt).toBe('PROMPT-2');
    expect(assembleCount).toBe(2);
  });

  it('invalidates cache when persisted target signature is inconsistent', async () => {
    let assembleCount = 0;
    const service = new ContextService({
      primaryTextGatherer: { gather: async () => ({ primaryText: 'PRIMARY' }) } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: ['src/a.ts'] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: {
        assemble: () => {
          assembleCount += 1;
          return { prompt: `PROMPT-${assembleCount}` };
        },
      },
    });
    (service as any).fileAdapter = {
      stat: async () => ({ mtimeMs: 1, size: 1 }),
    };

    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
    };

    await service.build(req);
    const cache = (service as any).cache as Map<string, any>;
    const key = [...cache.keys()][0]!;
    const entry = cache.get(key)!;
    entry.targetSetSignature = 'tampered-signature';
    cache.set(key, entry);

    const second = await service.build(req);
    expect(second.prompt).toBe('PROMPT-2');
    expect(assembleCount).toBe(2);
  });
});
