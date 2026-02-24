import * as fs from 'fs/promises';

import { AstParser } from '../../src/core/ast/parser.js';
import { ContextBuilder } from '../../src/core/context/builder.js';
import { spawnCommand } from '../../src/core/runtime/process-runner.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));
vi.mock('../../src/core/runtime/process-runner.js', () => ({
  spawnCommand: vi.fn(),
}));
vi.mock('../../src/core/ast/parser.js', () => ({
  AstParser: class {
    static parse = vi.fn();
    static identifyDefinitions = vi.fn();
    static identifyReferences = vi.fn();
  },
}));

describe('ContextBuilder', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default AST mocks
    (AstParser.parse as any).mockResolvedValue({} as any);
    (AstParser.identifyDefinitions as any).mockResolvedValue([]);
    (AstParser.identifyReferences as any).mockResolvedValue([]);
    (spawnCommand as any).mockResolvedValue({
      code: 1,
      signal: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should build context with primary file', async () => {
    (fs.readFile as any).mockResolvedValue('console.log("hello");');

    const context = await ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
      file: 'test.ts',
    });

    expect(context.primaryText).toContain('console.log("hello");');
    expect(context.repoPath).toBe(tempDir);
    expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('test.ts'), 'utf-8');
  });

  it('should abort when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    (fs.readFile as any).mockResolvedValue('console.log("hello");');

    await expect(
      ContextBuilder.build({
        instruction: 'fix something',
        verify: 'npm test',
        repoPath: tempDir,
        file: 'test.ts',
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled by user/i);
  });

  it('should include AST symbols in context', async () => {
    const code = 'function test() { console.log("hello"); }';
    (fs.readFile as any).mockResolvedValue(code);
    (AstParser.parse as any).mockResolvedValue({} as any);
    (AstParser.identifyDefinitions as any).mockResolvedValue([
      {
        name: 'test',
        kind: 'definition',
        location: { start: { line: 1, column: 9 }, end: { line: 1, column: 13 } },
      },
    ]);
    (AstParser.identifyReferences as any).mockResolvedValue([]);

    const context = await ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
      file: 'test.ts',
    });

    expect(Array.isArray(context.symbols)).toBe(true);
  });
});
