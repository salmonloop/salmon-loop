import { readFile } from 'fs/promises';
import { vi } from 'vitest';

import { ContextBuilder } from '../../src/core/context.js';
import * as git from '../../src/core/git.js';
import { StubLLM } from '../../src/core/llm.js';
import { SalmonLoop } from '../../src/core/loop.js';
import * as verify from '../../src/core/verify.js';
import { checkSyntaxErrors } from '../../src/core/ast/index.js';
import { text } from '../../src/locales/index.js';

vi.mock('../../src/core/context.js');
vi.mock('../../src/core/git.js', async () => {
  const actual = await vi.importActual('../../src/core/git.js');
  return {
    ...actual,
    applyPatch: vi.fn(),
    rollbackFiles: vi.fn(),
    getGitStatus: vi.fn(),
  };
});
vi.mock('../../src/core/verify.js', async () => {
  const actual = await vi.importActual('../../src/core/verify.js');
  return {
    ...actual,
    runVerify: vi.fn(),
    preflight: vi.fn(),
    classifyError: vi.fn(),
    verifyFileContent: vi.fn(),
  };
});
vi.mock('../../src/core/ast/index.js', () => {
  console.log('Mocking AstParser via index.js');
  return {
    AstParser: {
      parse: vi.fn().mockResolvedValue({
        delete: vi.fn(),
      }),
    },
    checkSyntaxErrors: vi.fn().mockReturnValue([]),
    validateScopeIntegrity: vi.fn().mockReturnValue({ ok: true }),
    getTopLevelNodes: vi.fn().mockReturnValue([]),
    getNodeName: vi.fn(),
  };
});

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

describe('SalmonLoop', () => {
  let loop: SalmonLoop;
  let mockLLM: StubLLM;

  beforeEach(() => {
    vi.useFakeTimers();
    loop = new SalmonLoop();
    mockLLM = new StubLLM();
    vi.clearAllMocks();

    // Default mock for rollbackFiles
    vi.mocked(git.rollbackFiles).mockResolvedValue({
      ok: true,
      attempted: [],
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    // Default mock for applyPatch
    vi.mocked(git.applyPatch).mockResolvedValue(undefined);
    // Default mock for getGitStatus
    vi.mocked(git.getGitStatus).mockResolvedValue('');
    // Default mock for shrinkContext
    vi.mocked(ContextBuilder.shrinkContext).mockImplementation(async (ctx) => ctx);
    // Default mock for preflight
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    // Default mock for readFile
    vi.mocked(readFile).mockResolvedValue(' ');
    // Default mock for checkSyntaxErrors
    vi.mocked(checkSyntaxErrors).mockReturnValue([]);
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should run successfully when verify passes', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValueOnce({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = vi.fn().mockResolvedValue({
      goal: 'test',
      files: ['test.txt'],
      changes: ['change'],
      verify: 'verify',
    });
    mockLLM.createPatch = vi.fn().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    vi.mocked(verify.runVerify).mockResolvedValueOnce({
      ok: true,
      output: 'Success',
      exitCode: 0,
    });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    if (!result.success) {
      throw new Error('Loop failed: ' + JSON.stringify(result, null, 2));
    }

    expect(result.success).toBe(true);
    expect(git.rollbackFiles).not.toHaveBeenCalled();
  });

  it('should not apply patch in dry-run mode', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValueOnce({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = vi
      .fn()
      .mockResolvedValue({ goal: 'test', files: [], changes: [], verify: '' });
    mockLLM.createPatch = vi.fn().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    vi.mocked(verify.runVerify).mockResolvedValueOnce({ ok: true, output: 'Success', exitCode: 0 });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.reasonCode).toBe('DRY_RUN');
    expect(git.applyPatch).not.toHaveBeenCalled();
  });

  it('should retry and rollback on failure', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValueOnce({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [{ file: 'test.txt', content: '...', line: 1 }],
    } as any);

    mockLLM.createPlan = vi
      .fn()
      .mockResolvedValue({ goal: 'test', files: ['test.txt'], changes: [], verify: '' });
    mockLLM.createPatch = vi.fn().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    vi.mocked(verify.runVerify)
      .mockResolvedValueOnce({ ok: false, output: 'Error in test.txt', exitCode: 1 })
      .mockResolvedValueOnce({ ok: true, output: 'Success', exitCode: 0 });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(git.rollbackFiles).toHaveBeenCalledWith(
      '/tmp/repo',
      expect.arrayContaining(['test.txt']),
      undefined,
    );
  });

  it('should rollback all changed files on failure, not just failed ones', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValueOnce({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = vi
      .fn()
      .mockResolvedValue({ goal: 'test', files: ['a.ts', 'b.ts'], changes: [], verify: '' });

    // Diff changes a.ts and b.ts
    mockLLM.createPatch = vi.fn().mockResolvedValue(`diff --git a/a.ts b/a.ts
index 123..456 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/b.ts b/b.ts
index 123..456 100644
--- b/b.ts
+++ b/b.ts
@@ -1 +1 @@
-old
+new`);

    // Verify fails only on a.ts
    vi.mocked(verify.runVerify)
      .mockResolvedValueOnce({ ok: false, output: 'Error in a.ts', exitCode: 1 })
      .mockResolvedValueOnce({ ok: true, output: 'Success', exitCode: 0 });

    // Run any pending timers to ensure async operations complete properly
    vi.runAllTimers();

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    // Ensure all timers are processed after loop completes
    vi.runAllTimers();

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    // Should rollback BOTH a.ts and b.ts
    expect(git.rollbackFiles).toHaveBeenCalledWith(
      '/tmp/repo',
      expect.arrayContaining(['a.ts', 'b.ts']),
      undefined,
    );
  });

  it('should fail when max retries exceeded', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValueOnce({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = vi
      .fn()
      .mockResolvedValue({ goal: 'test', files: [], changes: [], verify: '' });
    mockLLM.createPatch = vi.fn().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    vi.mocked(verify.runVerify).mockResolvedValue({ ok: false, output: 'Error', exitCode: 1 });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.reason).toBe(text.loop.exceededMaxRetriesSimple);
  });

  it('should handle unexpected errors', async () => {
    vi.mocked(ContextBuilder.build).mockRejectedValue(new Error('Context build failed'));

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe(text.loop.loopExecutionFailed);
    expect(result.logs[0].step).toBe('error');
  });
});
