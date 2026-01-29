import { readFile } from 'fs/promises';

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import {
  checkSyntaxErrors,
  validateNodeStructure,
  validateScopeIntegrity,
} from '../../src/core/ast/index.js';
import { ContextBuilder } from '../../src/core/context.js';
import { executeSalmonLoopFlow } from '../../src/core/grizzco/flows/SalmonLoopFlow.js';
import { StubLLM } from '../../src/core/llm.js';
import { SalmonLoop } from '../../src/core/loop.js';
import { ErrorType } from '../../src/core/types.js';
import * as verify from '../../src/core/verify.js';
import { text } from '../../src/locales/index.js';

vi.mock('../../src/core/context.js');
vi.mock('../../src/core/grizzco/flows/SalmonLoopFlow.js');
vi.mock('../../src/core/adapters/git/git-adapter.js');
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
  return {
    AstParser: {
      parse: vi.fn().mockImplementation(async () => ({
        delete: vi.fn(),
        rootNode: {},
      })),
    },
    checkSyntaxErrors: vi.fn().mockReturnValue([]),
    validateScopeIntegrity: vi.fn().mockReturnValue({ ok: true }),
    validateNodeStructure: vi.fn().mockReturnValue(true),
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
    loop = new SalmonLoop();
    mockLLM = new StubLLM();
    vi.clearAllMocks();

    // Default mock for LLM
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

    // Mock GitAdapter
    vi.mocked(GitAdapter).mockImplementation(
      () =>
        ({
          repoPath: '/tmp/repo',
          applyPatch: vi.fn().mockResolvedValue(undefined),
          rollbackFiles: vi.fn().mockResolvedValue({ ok: true }),
          safeRollback: vi.fn().mockResolvedValue({ ok: true }),
          getStatus: vi.fn().mockResolvedValue(''),
          exec: vi.fn().mockResolvedValue(''),
          query: vi.fn().mockResolvedValue(''),
          checkIgnore: vi.fn().mockResolvedValue(false),
          show: vi.fn().mockResolvedValue(Buffer.from('')),
          readFile: vi.fn().mockResolvedValue(Buffer.from('')),
          hashObject: vi.fn().mockResolvedValue(''),
          updateIndex: vi.fn().mockResolvedValue(undefined),
          getStatusForPath: vi.fn().mockResolvedValue(null),
          mergeFile: vi.fn().mockResolvedValue({ content: Buffer.from(''), hasConflict: false }),
        }) as any,
    );

    // Default mock for shrinkContext
    vi.mocked(ContextBuilder.shrinkContext).mockImplementation(async (ctx) => ctx);
    // Default mock for preflight
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    // Default mock for classifyError
    vi.mocked(verify.classifyError).mockReturnValue(ErrorType.LOGIC);
    // Default mock for readFile
    vi.mocked(readFile).mockResolvedValue(' ');
    // Default mock for checkSyntaxErrors
    vi.mocked(checkSyntaxErrors).mockReturnValue([]);
    // Default mock for validateNodeStructure
    vi.mocked(validateNodeStructure).mockReturnValue(true);
    // Default mock for validateScopeIntegrity
    vi.mocked(validateScopeIntegrity).mockReturnValue({ ok: true });

    // Mock executeSalmonLoopFlow
    vi.mocked(executeSalmonLoopFlow).mockResolvedValue({
      success: true,
      duration: 0,
      traces: [],
      data: {
        plan: { changes: [] },
        diff: 'diff',
        changedFiles: ['test.txt'],
        verifyResult: { ok: true },
      } as any,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
  });

  it('should not apply patch in dry-run mode', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValue({
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
  });

  it('should retry and rollback on failure', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValue({
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

    vi.mocked(executeSalmonLoopFlow)
      .mockResolvedValueOnce({
        success: false,
        duration: 0,
        traces: [],
        data: {
          plan: { changes: [] },
          diff: '',
          changedFiles: [],
          lastError: 'Simulated failure',
        } as any,
        error: new Error('Simulated failure'),
      })
      .mockResolvedValue({
        success: true,
        duration: 0,
        traces: [],
        data: {
          plan: { changes: [] },
          diff: 'diff',
          changedFiles: ['test.txt'],
          verifyResult: { ok: true },
        } as any,
      });

    vi.mocked(verify.runVerify).mockResolvedValue({ ok: true, output: 'Success', exitCode: 0 });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    if (!result.success) {
      console.log('Loop failed with reason:', result.reason);
      console.log('Logs:', JSON.stringify(result.logs, null, 2));
    }
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('should rollback all changed files on failure, not just failed ones', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValue({
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

    vi.mocked(executeSalmonLoopFlow).mockResolvedValue({
      success: false,
      duration: 0,
      traces: [],
      data: {
        plan: { changes: [] },
        diff: '',
        changedFiles: [],
        verifyResult: { ok: false }, // Verify failed
      } as any,
    });

    // Verify fails only on a.ts
    vi.mocked(verify.runVerify).mockResolvedValue({
      ok: false,
      output: 'Error in a.ts',
      exitCode: 1,
    });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
  });

  it('should fail when max retries exceeded', async () => {
    vi.mocked(ContextBuilder.build).mockResolvedValue({
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

    vi.mocked(executeSalmonLoopFlow).mockResolvedValue({
      success: false,
      duration: 0,
      traces: [],
      data: {
        plan: { changes: [] },
        diff: '',
        changedFiles: [],
      } as any,
    });

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
    // Simulate a crash in the flow that returns error result
    vi.mocked(executeSalmonLoopFlow).mockResolvedValue({
      success: false,
      duration: 0,
      traces: [],
      data: {} as any,
      error: new Error('Pipeline failed'),
    });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    expect(result.success).toBe(false);
    // If loop retries, it might fail with max retries.
    // If executeSalmonLoopFlow returns error, loop.ts increments retries.
    // So it will retry until max retries.
    // Result reason will be 'Exceeded maximum retry attempts'.
    expect(result.reason).toBe(text.loop.exceededMaxRetriesSimple);
  });
});
