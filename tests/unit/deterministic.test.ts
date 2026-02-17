import { ContextBuilder } from '../../src/core/context/builder.js';
import { FakeLLM } from '../../src/core/llm/index.js';
import * as verify from '../../src/core/verification/runner.js';
import { runSalmonLoop } from '../../src/index.js';

vi.mock('../../src/core/context/builder.js', () => ({
  ContextBuilder: {
    build: vi.fn(),
    extractFailedFiles: vi.fn().mockReturnValue([]),
    shrinkContext: vi.fn().mockImplementation((ctx) => Promise.resolve(ctx)),
  },
}));
vi.mock('../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: vi.fn().mockImplementation(() => ({
    execMeta: vi.fn().mockResolvedValue({ ok: true, stderr: '' }),
    applyPatch: vi.fn().mockResolvedValue(undefined),
    rollbackFiles: vi.fn().mockResolvedValue({ ok: true }),
    getStatus: vi.fn().mockResolvedValue(''),
    exec: vi.fn().mockImplementation((args) => {
      if (args[0] === 'config') return Promise.resolve('mock-value');
      return Promise.resolve('');
    }),
    query: vi.fn().mockResolvedValue(''),
    checkIgnore: vi.fn().mockResolvedValue(false),
  })),
}));
vi.mock('../../src/core/ast/index.js', () => ({
  AstParser: {
    parse: vi.fn().mockResolvedValue({
      delete: vi.fn(),
    }),
  },
  checkSyntaxErrors: vi.fn().mockReturnValue([]),
  validateScopeIntegrity: vi.fn().mockReturnValue({ ok: true }),
  validateNodeStructure: vi.fn().mockReturnValue(true),
  getTopLevelNodes: vi.fn().mockReturnValue([]),
  getNodeName: vi.fn(),
}));
vi.mock('../../src/core/verification/runner.js', async () => {
  const actual = await vi.importActual('../../src/core/verification/runner.js');
  return {
    ...actual,
    runVerify: vi.fn(),
    preflight: vi.fn(),
  };
});

describe('Deterministic Baseline Tests', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    vi.mocked(ContextBuilder.build).mockResolvedValue({
      repoPath: tempDir,
      rgSnippets: [],
    } as any);
  });

  it('should fix a compilation error', async () => {
    vi.mocked(verify.runVerify).mockResolvedValue({ ok: true, output: 'success', exitCode: 0 });

    const fakeLLM = new FakeLLM(
      [{ goal: 'fix type', files: ['index.ts'], changes: ['fix type'], verify: 'tsc' }],
      [
        `diff --git a/index.ts b/index.ts
--- a/index.ts
+++ b/index.ts
@@ -1 +1 @@
-const x: number = "not a number";
+const x: number = 123;
`,
      ],
    );

    const result = await runSalmonLoop({
      instruction: 'fix compilation error',
      verify: 'echo "success"',
      repoPath: tempDir,
      llm: fakeLLM,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('should fail-fast on diff limit exceeded', async () => {
    // Generate a very large diff (exceeding default limits)
    const largeDiff = `diff --git a/large.ts b/large.ts
--- a/large.ts
+++ b/large.ts
${Array(1000).fill('+new line').join('\n')}`;

    const fakeLLM = new FakeLLM(
      [{ goal: 'too big', files: ['large.ts'], changes: ['too big'], verify: 'test' }],
      [largeDiff],
    );

    const result = await runSalmonLoop({
      instruction: 'make it large',
      verify: 'echo "success"',
      repoPath: tempDir,
      llm: fakeLLM,
    });

    expect(result.success).toBe(false);
    expect(['PATCH', 'VERIFY']).toContain(result.failurePhase);
  });

  it('should reject dirty workspace by default', async () => {
    vi.mocked(verify.preflight).mockResolvedValue({
      ok: false,
      reason: 'Workspace has uncommitted changes\nM dirty.ts',
    });

    const fakeLLM = new FakeLLM([], []);

    const result = await runSalmonLoop({
      instruction: 'any',
      verify: 'any',
      repoPath: tempDir,
      llm: fakeLLM,
    });

    expect(result.success).toBe(false);
    // Check logs for the error, as main reason might be generic "Max retries"
    const hasErrorLog = result.logs.some((l) =>
      l.output.includes('Workspace has uncommitted changes'),
    );
    expect(hasErrorLog).toBe(true);
    expect(result.failurePhase).toBe('PREFLIGHT');
  });
});
