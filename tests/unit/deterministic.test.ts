import { ContextBuilder } from '../../src/core/context/builder.js';
import { FakeLLM } from '../../src/core/llm/index.js';
import * as verify from '../../src/core/verification/runner.js';
import { runSalmonLoop } from '../../src/index.js';

type MockFn = ReturnType<typeof mock>;
const asMockFn = (fn: unknown): MockFn => fn as MockFn;

mock.module('../../src/core/context/builder.js', () => ({
  ContextBuilder: {
    build: mock(),
    extractFailedFiles: mock().mockReturnValue([]),
    shrinkContext: mock().mockImplementation((ctx: unknown) => Promise.resolve(ctx)),
  },
}));
mock.module('../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: mock().mockImplementation(() => ({
    execMeta: mock().mockResolvedValue({ ok: true, stderr: '' }),
    applyPatch: mock().mockResolvedValue(undefined),
    rollbackFiles: mock().mockResolvedValue({ ok: true }),
    getStatus: mock().mockResolvedValue(''),
    exec: mock().mockImplementation((args: unknown) => {
      if (Array.isArray(args) && args[0] === 'config') return Promise.resolve('mock-value');
      return Promise.resolve('');
    }),
    query: mock().mockResolvedValue(''),
    checkIgnore: mock().mockResolvedValue(false),
  })),
}));
mock.module('../../src/core/ast/index.js', () => ({
  AstParser: {
    parse: mock().mockResolvedValue({
      delete: mock(),
    }),
  },
  checkSyntaxErrors: mock().mockReturnValue([]),
  validateScopeIntegrity: mock().mockReturnValue({ ok: true }),
  validateNodeStructure: mock().mockReturnValue(true),
  getTopLevelNodes: mock().mockReturnValue([]),
  getNodeName: mock(),
}));
mock.module('../../src/core/verification/runner.js', () => {
  return {
    runVerify: mock(),
    preflight: mock(),
    classifyError: mock(),
  };
});

describe('Deterministic Baseline Tests', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    mock.clearAllMocks();

    // Default mocks
    asMockFn(verify.preflight).mockResolvedValue({ ok: true });
    asMockFn(ContextBuilder.build).mockResolvedValue({
      repoPath: tempDir,
      rgSnippets: [],
    });
  });

  it('should fix a compilation error', async () => {
    asMockFn(verify.runVerify).mockResolvedValue({ ok: true, output: 'success', exitCode: 0 });

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
    expect(result.failurePhase).toBeDefined();
    if (!result.failurePhase) {
      throw new Error('Expected failurePhase to be defined for oversized patch failure');
    }
    expect(['PATCH', 'VERIFY']).toContain(result.failurePhase);
  });

  it('should reject dirty workspace by default', async () => {
    asMockFn(verify.preflight).mockResolvedValue({
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
