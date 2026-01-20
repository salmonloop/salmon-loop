import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import mockFs from 'mock-fs';

import * as git from '../../src/core/git.js';
import { LLM } from '../../src/core/llm.js';
import { runSalmonLoop } from '../../src/core/loop.js';
import * as verify from '../../src/core/verify.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

const mockLlm = {
  createPlan: vi.fn(),
  createPatch: vi.fn(),
} as unknown as LLM;

vi.mock('../../src/core/git.js', async () => {
  const actual = await vi.importActual('../../src/core/git.js');
  return {
    ...actual,
    applyPatch: vi.fn(),
    rollbackFiles: vi.fn().mockResolvedValue({ ok: true }),
    getGitStatus: vi.fn(),
    getGitDiff: vi.fn(),
  };
});

vi.mock('../../src/core/context.js', () => ({
  ContextBuilder: {
    build: vi.fn().mockResolvedValue({
      repoPath: '/large-repo',
      rgSnippets: [],
      primaryText: '',
    }),
    shrinkContext: vi.fn().mockImplementation((ctx) => Promise.resolve(ctx)),
    extractFailedFiles: vi.fn(),
  },
}));

vi.mock('../../src/core/ast/index.js', () => ({
  AstParser: {
    parse: vi.fn().mockResolvedValue({
      delete: vi.fn(),
    }),
  },
  checkSyntaxErrors: vi.fn().mockReturnValue([]),
  validateScopeIntegrity: vi.fn().mockReturnValue({ ok: true }),
  getTopLevelNodes: vi.fn().mockReturnValue([]),
  getNodeName: vi.fn(),
}));

vi.mock('../../src/core/verify.js', async () => {
  const actual = await vi.importActual('../../src/core/verify.js');
  return {
    ...actual,
    runVerify: vi.fn(),
    preflight: vi.fn(),
  };
});

describe('Performance Integration Tests', () => {
  const repoPath = '/large-repo';

  beforeEach(() => {
    // Mock spawn for rg and git
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit('close', 0), 0);
      return child;
    });

    // Simulate a large repository with 1000 files
    const largeRepo: any = {
      '.git': {},
    };
    for (let i = 0; i < 1000; i++) {
      largeRepo[`file${i}.ts`] = `console.log("file ${i}");`;
    }

    mockFs({
      [repoPath]: largeRepo,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockFs.restore();
  });

  it('should handle a large repository without significant delay', async () => {
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    vi.mocked(mockLlm.createPlan).mockResolvedValue({
      goal: 'Fix',
      files: [],
      changes: [],
      verify: 'npm test',
    });
    vi.mocked(mockLlm.createPatch).mockResolvedValue(
      'diff --git a/file0.ts b/file0.ts\n--- a/file0.ts\n+++ b/file0.ts\n@@ -1,1 +1,1 @@\n-console.log("file 0");\n+console.log("fixed");',
    );
    vi.mocked(git.applyPatch).mockResolvedValue(undefined);
    vi.mocked(verify.runVerify).mockResolvedValue({ ok: true, output: '', exitCode: 0 });

    console.time('SalmonLoop performance');
    const start = Date.now();
    const result = await runSalmonLoop({
      instruction: 'Fix file0',
      verify: 'npm test',
      repoPath: repoPath,
      llm: mockLlm,
    });
    const end = Date.now();
    console.timeEnd('SalmonLoop performance');
    console.log(`File count: 1000, Total time: ${end - start}ms`);

    expect(result.success).toBe(true);
    expect(end - start).toBeLessThan(5000); // Should complete within 5 seconds in mock environment
  });
});
