import { runSalmonLoop } from '../../src/index.js';
import { FakeLLM } from '../../src/core/llm.js';
import { ExecutionPhase } from '../../src/core/types.js';
import { ContextBuilder } from '../../src/core/context.js';
import * as git from '../../src/core/git.js';
import * as verify from '../../src/core/verify.js';

vi.mock('fs/promises');
vi.mock('../../src/core/context.js');
vi.mock('../../src/core/git.js');
vi.mock('../../src/core/verify.js');

describe('Deterministic Baseline Tests', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    vi.mocked(ContextBuilder.build).mockResolvedValue({
      repoPath: tempDir,
      rgSnippets: [],
    });
    vi.mocked(git.getGitStatus).mockResolvedValue('');
  });

  it('should fix a compilation error', async () => {
    vi.mocked(verify.runVerify).mockResolvedValue({ ok: true, output: 'success', exitCode: 0 });
    vi.mocked(git.applyPatch).mockResolvedValue(undefined);

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
      allowDirty: true,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(git.applyPatch).toHaveBeenCalled();
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
      allowDirty: true,
    });

    expect(result.success).toBe(false);
    expect(result.failurePhase).toBe(ExecutionPhase.VALIDATE);
  });

  it('should reject dirty workspace by default', async () => {
    vi.mocked(verify.preflight).mockResolvedValue({ ok: false, reason: 'Workspace has uncommitted changes\nM dirty.ts' });

    const fakeLLM = new FakeLLM([], []);

    const result = await runSalmonLoop({
      instruction: 'any',
      verify: 'any',
      repoPath: tempDir,
      llm: fakeLLM,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Workspace has uncommitted changes');
    expect(result.failurePhase).toBe(ExecutionPhase.PREFLIGHT);
  });

  it('should reject allowDirty + forceReset combination', async () => {
    const fakeLLM = new FakeLLM([], []);

    const result = await runSalmonLoop({
      instruction: 'any',
      verify: 'any',
      repoPath: tempDir,
      llm: fakeLLM,
      allowDirty: true,
      forceReset: true,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Safety Guard');
    expect(result.failurePhase).toBe(ExecutionPhase.PREFLIGHT);
  });
});
