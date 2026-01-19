import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalmonLoop } from '../../src/core/loop';
import { ContextBuilder } from '../../src/core/context';
import { StubLLM } from '../../src/core/llm';
import * as git from '../../src/core/git';
import * as verify from '../../src/core/verify';
import { text } from '../../src/locales/index';
import { LIMITS } from '../../src/core/limits';

vi.mock('../../src/core/context');
vi.mock('../../src/core/git');
vi.mock('../../src/core/verify');

describe('SalmonLoop', () => {
  let loop: SalmonLoop;
  let mockLLM: StubLLM;

  beforeEach(() => {
    loop = new SalmonLoop();
    mockLLM = new StubLLM();
    vi.clearAllMocks();
    
    // Default mock for rollbackFiles
    vi.mocked(git.rollbackFiles).mockResolvedValue({
      ok: true,
      attempted: [],
      exitCode: 0,
      stdout: '',
      stderr: ''
    });
    // Default mock for shrinkContext
    vi.mocked(ContextBuilder.shrinkContext).mockImplementation(async (ctx) => ctx);
    // Default mock for preflight
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
  });

  it('should run successfully when verify passes', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = vi.fn().mockResolvedValue({
      goal: 'test',
      files: ['test.txt'],
      changes: ['change'],
      verify: 'verify'
    });
    mockLLM.createPatch = vi.fn().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    vi.mocked(verify.runVerify).mockResolvedValue({
      ok: true,
      output: 'Success',
      exitCode: 0
    });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.reason).toBe(text.loop.operationCompleted);
    expect(git.applyPatch).toHaveBeenCalled();
  });

  it('should not apply patch in dry-run mode', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = vi.fn().mockResolvedValue({ goal: 'test', files: [], changes: [], verify: '' });
    mockLLM.createPatch = vi.fn().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    vi.mocked(verify.runVerify).mockResolvedValue({ ok: true, output: 'Success', exitCode: 0 });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
      dryRun: true
    });

    expect(result.success).toBe(true);
    expect(git.applyPatch).not.toHaveBeenCalled();
  });

  it('should retry and rollback on failure', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [{ file: 'test.txt', content: '...', line: 1 }],
    } as any);

    mockLLM.createPlan = vi.fn().mockResolvedValue({ goal: 'test', files: ['test.txt'], changes: [], verify: '' });
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
    expect(git.rollbackFiles).toHaveBeenCalledWith('/tmp/repo', expect.arrayContaining(['test.txt']), undefined);
  });

  it('should rollback all changed files on failure, not just failed ones', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = vi.fn().mockResolvedValue({ goal: 'test', files: ['a.ts', 'b.ts'], changes: [], verify: '' });
    
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
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-old
+new`);

    // Verify fails only on a.ts
    vi.mocked(verify.runVerify)
      .mockResolvedValueOnce({ ok: false, output: 'Error in a.ts', exitCode: 1 })
      .mockResolvedValueOnce({ ok: true, output: 'Success', exitCode: 0 });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    // Should rollback BOTH a.ts and b.ts
    expect(git.rollbackFiles).toHaveBeenCalledWith('/tmp/repo', expect.arrayContaining(['a.ts', 'b.ts']), undefined);
  });

  it('should fail when max retries exceeded', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = vi.fn().mockResolvedValue({ goal: 'test', files: [], changes: [], verify: '' });
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
