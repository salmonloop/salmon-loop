import { AstParser } from '../../src/core/ast/parser.js';
import { resolveConfig } from '../../src/core/config/resolve.js';
import { ContextBuilder } from '../../src/core/context/builder.js';
import { spawnCommand } from '../../src/core/runtime/process-runner.js';

const readFileMock = mock();

mock.module('../../src/core/adapters/fs/file-adapter.js', () => ({
  FileAdapter: class {
    readFile = readFileMock;
    stat = mock();
    exists = mock().mockResolvedValue(false);
    readdir = mock().mockResolvedValue([]);
    readdirWithTypes = mock().mockResolvedValue([]);
    mkdir = mock();
    writeFile = mock();
    writeFileAtomic = mock();
    deleteFile = mock();
  },
}));
mock.module('../../src/core/config/resolve.js', () => ({
  resolveConfig: mock(),
}));
mock.module('../../src/core/runtime/process-runner.js', () => ({
  spawnCommand: mock(),
}));
mock.module('../../src/core/ast/parser.js', () => ({
  AstParser: class {
    static parse = mock();
    static identifyDefinitions = mock();
    static identifyReferences = mock();
  },
}));

describe('ContextBuilder', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    mock.clearAllMocks();

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
    (resolveConfig as any).mockResolvedValue({
      raw: {},
    });
  });

  afterEach(() => {
    mock.restore();
  });

  it('should build context with primary file', async () => {
    readFileMock.mockResolvedValue('console.log("hello");');

    const result = await ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
      file: 'test.ts',
    });

    expect(result.context.primaryText).toContain('console.log("hello");');
    expect(result.context.repoPath).toBe(tempDir);
    expect(readFileMock).toHaveBeenCalledWith(expect.stringContaining('test.ts'), 'utf-8');
  });

  it('should abort when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    readFileMock.mockResolvedValue('console.log("hello");');

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
    readFileMock.mockResolvedValue(code);
    (AstParser.parse as any).mockResolvedValue({} as any);
    (AstParser.identifyDefinitions as any).mockResolvedValue([
      {
        name: 'test',
        kind: 'definition',
        location: { start: { line: 1, column: 9 }, end: { line: 1, column: 13 } },
      },
    ]);
    (AstParser.identifyReferences as any).mockResolvedValue([]);

    const result = await ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
      file: 'test.ts',
    });

    expect(Array.isArray(result.context.symbols)).toBe(true);
  });
});
