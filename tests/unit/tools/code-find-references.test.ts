import { describe, expect, it, beforeEach, mock } from 'bun:test';

import { readFile } from '../../../src/core/adapters/fs/node-fs.js';
import { AstParser } from '../../../src/core/ast/parser.js';
import { spawnCommand } from '../../../src/core/runtime/process-runner.js';
import {
  codeFindReferencesSpec,
  executeCodeFindReferences,
} from '../../../src/core/tools/builtin/ast.js';

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  readFile: mock(),
  stat: mock(),
}));

mock.module('../../../src/core/ast/parser.js', () => ({
  AstParser: {
    parse: mock(),
    identifyDefinitions: mock(),
    identifyReferences: mock(),
  },
}));

mock.module('../../../src/core/plugin/registry.js', () => ({
  getPluginRegistry: mock(),
  tryGetPluginRegistry: mock(() => ({
    getByExtension: (file: string) => {
      if (file.endsWith('.ts') || file.endsWith('.js')) {
        return { meta: { id: 'typescript' } };
      }
      return undefined;
    },
  })),
}));

mock.module('../../../src/core/runtime/process-runner.js', () => ({
  spawnCommand: mock(),
}));

describe('Builtin Tool: code.find_references', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {
    mock.restore();
  });

  it('should find definition and references across files', async () => {
    // Target file has a definition
    (readFile as any).mockImplementation(async (path: string) => {
      if (path.includes('src/main.ts')) return 'export function greet() {}';
      if (path.includes('src/app.ts')) return 'import { greet } from "./main"; greet();';
      return '';
    });

    (AstParser.parse as any).mockResolvedValue({});
    (AstParser.identifyDefinitions as any).mockImplementation(async (_tree: any, _lang: string) => {
      return [
        {
          name: 'greet',
          location: { start: { line: 0, column: 17 }, end: { line: 0, column: 22 } },
        },
      ];
    });
    (AstParser.identifyReferences as any).mockImplementation(async (_tree: any, _lang: string) => {
      return [
        {
          name: 'greet',
          location: { start: { line: 0, column: 40 }, end: { line: 0, column: 45 } },
        },
      ];
    });

    // Mock ripgrep to return app.ts
    (spawnCommand as any).mockImplementation(async (opts: any) => {
      opts.onStdoutChunk?.(Buffer.from('src/app.ts\n'));
      return { code: 0 };
    });

    const result = await executeCodeFindReferences(
      { file: 'src/main.ts', symbol: 'greet' },
      { repoRoot, attemptId: 1, dryRun: false },
    );

    expect(result.definition).not.toBeNull();
    expect(result.definition?.file).toBe('src/main.ts');
    expect(result.definition?.name).toBe('greet');
    expect(result.filesScanned).toBeGreaterThan(0);
  });

  it('should return null definition when symbol not defined in target file', async () => {
    (readFile as any).mockResolvedValue('const x = 1;');
    (AstParser.parse as any).mockResolvedValue({});
    (AstParser.identifyDefinitions as any).mockResolvedValue([]);
    (AstParser.identifyReferences as any).mockResolvedValue([]);
    (spawnCommand as any).mockResolvedValue({ code: 1 });

    const result = await executeCodeFindReferences(
      { file: 'src/main.ts', symbol: 'unknown' },
      { repoRoot, attemptId: 1, dryRun: false },
    );

    expect(result.definition).toBeNull();
    expect(result.references).toEqual([]);
  });

  it('should exclude target file from rg candidates', async () => {
    (readFile as any).mockResolvedValue('export function foo() { foo(); }');
    (AstParser.parse as any).mockResolvedValue({});
    (AstParser.identifyDefinitions as any).mockResolvedValue([
      { name: 'foo', location: { start: { line: 0, column: 17 }, end: { line: 0, column: 20 } } },
    ]);
    (AstParser.identifyReferences as any).mockResolvedValue([]);

    // rg returns the target file itself — should be excluded
    (spawnCommand as any).mockImplementation(async (opts: any) => {
      opts.onStdoutChunk?.(Buffer.from('src/main.ts\n'));
      return { code: 0 };
    });

    const result = await executeCodeFindReferences(
      { file: 'src/main.ts', symbol: 'foo' },
      { repoRoot, attemptId: 1, dryRun: false },
    );

    // Only the target file itself would be scanned (from import neighbors), rg candidates excluded
    expect(result.filesScanned).toBeLessThanOrEqual(1);
  });

  it('should validate input schema', () => {
    const valid = codeFindReferencesSpec.inputSchema.safeParse({
      file: 'src/main.ts',
      symbol: 'foo',
    });
    expect(valid.success).toBe(true);

    const missingSymbol = codeFindReferencesSpec.inputSchema.safeParse({
      file: 'src/main.ts',
    });
    expect(missingSymbol.success).toBe(false);
  });

  it('should handle rg failure gracefully', async () => {
    (readFile as any).mockResolvedValue('export function bar() {}');
    (AstParser.parse as any).mockResolvedValue({});
    (AstParser.identifyDefinitions as any).mockResolvedValue([]);
    (AstParser.identifyReferences as any).mockResolvedValue([]);
    (spawnCommand as any).mockResolvedValue({ code: 2, error: new Error('rg not found') });

    const result = await executeCodeFindReferences(
      { file: 'src/main.ts', symbol: 'bar' },
      { repoRoot, attemptId: 1, dryRun: false },
    );

    expect(result.references).toEqual([]);
    expect(result.filesScanned).toBe(0);
  });
});
