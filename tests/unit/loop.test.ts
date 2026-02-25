const runtimeEnvSetupMock = mock();
const runtimeEnvTeardownMock = mock();
const createCheckpointCommitMock = mock();
const applyBackToMainWorkspaceMock = mock();

mock.module('../../src/core/strata/runtime/environment.js', () => {
  return {
    RuntimeEnvironment: class {
      public workspace?: { baseRepoPath: string; workPath: string; strategy: string };
      public checkpointManager: Record<string, unknown> = {};
      public checkpointRef?: {
        strategy: 'worktree';
        repoPath: string;
        worktreePath: string;
        baseRef: string;
        branchName: string;
      };
      public initialSnapshotHash?: string;

      constructor(
        private options: any,
        private emit: (...args: unknown[]) => void,
      ) {}

      get activeRepoPath(): string {
        return this.workspace?.workPath || this.options.repoPath;
      }

      async setup(): Promise<void> {
        runtimeEnvSetupMock(this.options);
        const strategy = this.options.strategy || 'direct';
        this.workspace = {
          baseRepoPath: this.options.repoPath,
          workPath: this.options.repoPath,
          strategy,
        };
        if (strategy === 'worktree') {
          this.initialSnapshotHash = 'mock-snapshot';
          this.checkpointRef = {
            strategy: 'worktree',
            repoPath: this.options.repoPath,
            worktreePath: this.workspace.workPath,
            baseRef: this.initialSnapshotHash,
            branchName: 'workspace',
          };
        }
      }

      async teardown(): Promise<void> {
        runtimeEnvTeardownMock();
      }
    },
  };
});

mock.module('../../src/core/strata/runtime/synchronizer.js', () => ({
  WorkspaceSynchronizer: class {
    constructor(_: unknown) {}
    createCheckpointCommit = createCheckpointCommitMock;
    applyBackToMainWorkspace = applyBackToMainWorkspaceMock;
  },
}));

import { readFile } from 'fs/promises';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import {
  checkSyntaxErrors,
  validateNodeStructure,
  validateScopeIntegrity,
} from '../../src/core/ast/index.js';
import { ContextBuilder } from '../../src/core/context/builder.js';
import * as salmonLoopFlow from '../../src/core/grizzco/flows/SalmonLoopFlow.js';
import { StubLLM } from '../../src/core/llm/index.js';
import { SalmonLoop } from '../../src/core/runtime/loop.js';
import { ErrorType, Phase } from '../../src/core/types/index.js';
import * as verify from '../../src/core/verification/runner.js';
import { text } from '../../src/locales/index.js';

mock.module('../../src/core/verification/runner.js', () => {
  return {
    runVerify: mock(),
    preflight: mock(),
    classifyError: mock(),
    verifyFileContent: mock(),
  };
});
mock.module('../../src/core/ast/index.js', () => {
  return {
    AstParser: {
      parse: mock().mockImplementation(async () => ({
        delete: mock(),
        rootNode: {},
      })),
    },
    checkSyntaxErrors: mock().mockReturnValue([]),
    validateScopeIntegrity: mock().mockReturnValue({ ok: true }),
    validateNodeStructure: mock().mockReturnValue(true),
    getTopLevelNodes: mock().mockReturnValue([]),
    getNodeName: mock(),
  };
});

mock.module('fs/promises', () => ({
  readFile: mock().mockResolvedValue(''),
  writeFile: mock(),
  unlink: mock(),
}));

describe('SalmonLoop', () => {
  let loop: SalmonLoop;
  let mockLLM: StubLLM;
  let executeFlowSpy: any;

  beforeEach(() => {
    loop = new SalmonLoop();
    mockLLM = new StubLLM();
    mock.clearAllMocks();
    createCheckpointCommitMock.mockResolvedValue('final-ref');
    applyBackToMainWorkspaceMock.mockResolvedValue(undefined);

    // Default mock for LLM
    mockLLM.createPlan = mock().mockResolvedValue({
      goal: 'test',
      files: ['test.txt'],
      changes: ['change'],
      verify: 'verify',
    });
    mockLLM.createPatch = mock().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    const mockedAdapter = {
      repoPath: '/tmp/repo',
      applyPatch: mock().mockResolvedValue(undefined),
      rollbackFiles: mock().mockResolvedValue({ ok: true }),
      safeRollback: mock().mockResolvedValue({ ok: true }),
      getStatus: mock().mockResolvedValue(''),
      exec: mock().mockResolvedValue(''),
      query: mock().mockResolvedValue(''),
      checkIgnore: mock().mockResolvedValue(false),
      show: mock().mockResolvedValue(Buffer.from('')),
      readFile: mock().mockResolvedValue(Buffer.from('')),
      hashObject: mock().mockResolvedValue(''),
      updateIndex: mock().mockResolvedValue(undefined),
      getStatusForPath: mock().mockResolvedValue(null),
      mergeFile: mock().mockResolvedValue({ content: Buffer.from(''), hasConflict: false }),
    };
    const gitAdapterConstructor = GitAdapter as unknown as {
      mockImplementation?: (impl: any) => void;
    };
    if (typeof gitAdapterConstructor.mockImplementation === 'function') {
      gitAdapterConstructor.mockImplementation(() => mockedAdapter as any);
    } else {
      spyOn(GitAdapter.prototype as any, 'applyPatch').mockImplementation(
        mockedAdapter.applyPatch as any,
      );
      spyOn(GitAdapter.prototype as any, 'rollbackFiles').mockImplementation(
        mockedAdapter.rollbackFiles as any,
      );
      spyOn(GitAdapter.prototype as any, 'safeRollback').mockImplementation(
        mockedAdapter.safeRollback as any,
      );
      spyOn(GitAdapter.prototype as any, 'getStatus').mockImplementation(
        mockedAdapter.getStatus as any,
      );
      spyOn(GitAdapter.prototype as any, 'exec').mockImplementation(mockedAdapter.exec as any);
      spyOn(GitAdapter.prototype as any, 'query').mockImplementation(mockedAdapter.query as any);
      spyOn(GitAdapter.prototype as any, 'checkIgnore').mockImplementation(
        mockedAdapter.checkIgnore as any,
      );
      spyOn(GitAdapter.prototype as any, 'show').mockImplementation(mockedAdapter.show as any);
      spyOn(GitAdapter.prototype as any, 'readFile').mockImplementation(
        mockedAdapter.readFile as any,
      );
      spyOn(GitAdapter.prototype as any, 'hashObject').mockImplementation(
        mockedAdapter.hashObject as any,
      );
      spyOn(GitAdapter.prototype as any, 'updateIndex').mockImplementation(
        mockedAdapter.updateIndex as any,
      );
      spyOn(GitAdapter.prototype as any, 'getStatusForPath').mockImplementation(
        mockedAdapter.getStatusForPath as any,
      );
      spyOn(GitAdapter.prototype as any, 'mergeFile').mockImplementation(
        mockedAdapter.mergeFile as any,
      );
    }

    // Default mock for shrinkContext
    spyOn(ContextBuilder, 'shrinkContext').mockImplementation(async (ctx: any) => ctx);
    // Default mock for preflight
    (verify.preflight as any).mockResolvedValue({ ok: true });
    // Default mock for classifyError
    (verify.classifyError as any).mockReturnValue(ErrorType.LOGIC);
    // Default mock for readFile
    (readFile as any).mockResolvedValue(' ');
    // Default mock for checkSyntaxErrors
    (checkSyntaxErrors as any).mockReturnValue([]);
    // Default mock for validateNodeStructure
    (validateNodeStructure as any).mockReturnValue(true);
    // Default mock for validateScopeIntegrity
    (validateScopeIntegrity as any).mockReturnValue({ ok: true });

    // Mock executeSalmonLoopFlow
    executeFlowSpy = spyOn(salmonLoopFlow, 'executeSalmonLoopFlow').mockResolvedValue({
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
    mock.restore();
  });

  it('should run successfully when verify passes', async () => {
    spyOn(ContextBuilder, 'build').mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = mock().mockResolvedValue({
      goal: 'test',
      files: ['test.txt'],
      changes: ['change'],
      verify: 'verify',
    });
    mockLLM.createPatch = mock().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    (verify.runVerify as any).mockResolvedValueOnce({
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
    spyOn(ContextBuilder, 'build').mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = mock().mockResolvedValue({
      goal: 'test',
      files: [],
      changes: [],
      verify: '',
    });
    mockLLM.createPatch = mock().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    (verify.runVerify as any).mockResolvedValueOnce({ ok: true, output: 'Success', exitCode: 0 });

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
    spyOn(ContextBuilder, 'build').mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [{ file: 'test.txt', content: '...', line: 1 }],
    } as any);

    mockLLM.createPlan = mock().mockResolvedValue({
      goal: 'test',
      files: ['test.txt'],
      changes: [],
      verify: '',
    });
    mockLLM.createPatch = mock().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    executeFlowSpy
      .mockResolvedValueOnce({
        success: true,
        duration: 0,
        traces: [],
        data: {
          plan: { changes: [] },
          diff: '',
          changedFiles: [],
          verifyResult: { ok: false, output: 'Test suites: 1 failed, 1 total', exitCode: 1 },
          lastError: 'Simulated failure',
        } as any,
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

    (verify.runVerify as any).mockResolvedValue({ ok: true, output: 'Success', exitCode: 0 });

    const result = await loop.run({
      instruction: 'fix bug',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('should rollback all changed files on failure, not just failed ones', async () => {
    spyOn(ContextBuilder, 'build').mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = mock().mockResolvedValue({
      goal: 'test',
      files: ['a.ts', 'b.ts'],
      changes: [],
      verify: '',
    });

    // Diff changes a.ts and b.ts
    mockLLM.createPatch = mock().mockResolvedValue(`diff --git a/a.ts b/a.ts
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

    executeFlowSpy.mockResolvedValue({
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
    (verify.runVerify as any).mockResolvedValue({
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
    spyOn(ContextBuilder, 'build').mockResolvedValue({
      repoPath: '/tmp/repo',
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    mockLLM.createPlan = mock().mockResolvedValue({
      goal: 'test',
      files: [],
      changes: [],
      verify: '',
    });
    mockLLM.createPatch = mock().mockResolvedValue(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`);

    executeFlowSpy.mockResolvedValue({
      success: true,
      duration: 0,
      traces: [],
      data: {
        plan: { changes: [] },
        diff: '',
        changedFiles: [],
        verifyResult: {
          ok: false,
          output: 'TS2322: Type string is not assignable to type number',
          exitCode: 1,
        },
      } as any,
    });

    (verify.runVerify as any).mockResolvedValue({ ok: false, output: 'Error', exitCode: 1 });

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
    executeFlowSpy.mockResolvedValue({
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
    expect(result.reasonCode).toBe('LOOP_FAILED');
    expect(result.attempts).toBe(1);
  });

  it('should fail when apply-back phase reports failure', async () => {
    executeFlowSpy.mockResolvedValueOnce({
      success: true,
      duration: 0,
      traces: [],
      data: {
        plan: { changes: [] },
        diff: 'diff',
        changedFiles: ['test.txt'],
        verifyResult: { ok: true },
        applyBackResult: {
          success: false,
          skipped: false,
          error: 'apply-back failure',
          telemetry: {},
        },
      } as any,
    });

    const result = await loop.run({
      instruction: 'apply patch',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      strategy: 'worktree',
      llm: mockLLM,
    });

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('APPLY_BACK_FAILED');
    expect(result.failurePhase).toBe(Phase.APPLY_BACK);
    expect(result.attempts).toBe(1);
  });

  it('should skip apply-back when using review flow', async () => {
    const result = await loop.run({
      instruction: 'review',
      verify: 'npm test',
      repoPath: '/tmp/repo',
      llm: mockLLM,
      mode: 'review',
    });

    expect(result.success).toBe(true);
    expect(applyBackToMainWorkspaceMock).not.toHaveBeenCalled();
  });
});
