import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { LLM } from '../../src/core/llm.js';
import { runSalmonLoop } from '../../src/core/loop.js';
import * as verify from '../../src/core/verification/runner.js';

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('events');
  return {
    spawn: vi.fn().mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = vi.fn();
      child.stdin.write = vi.fn();
      child.kill = vi.fn();
      return child;
    }),
    exec: vi.fn().mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      if (cb) cb(null, '', '');
      return { stdout: '', stderr: '' };
    }),
  };
});

const mockLlm = {
  createPlan: vi.fn(),
  createPatch: vi.fn(),
  chat: vi.fn().mockResolvedValue({ role: 'assistant', content: 'Ready' }),
} as unknown as LLM;

vi.mock('../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: vi.fn().mockImplementation(() => ({
    applyPatch: vi.fn().mockResolvedValue(undefined),
    rollbackFiles: vi.fn().mockResolvedValue({ ok: true }),
    getStatus: vi.fn().mockResolvedValue(''),
    exec: vi.fn().mockResolvedValue(''),
    query: vi.fn().mockResolvedValue(''),
  })),
}));

vi.mock('../../src/core/context/builder.js', () => ({
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
  validateNodeStructure: vi.fn().mockReturnValue(true),
  getTopLevelNodes: vi.fn().mockReturnValue([]),
  getNodeName: vi.fn(),
}));

vi.mock('../../src/core/verification/runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/verification/runner.js')>();
  return {
    ...actual,
    runVerify: vi.fn(),
    preflight: vi.fn(),
    classifyError: vi.fn().mockReturnValue('logic'),
  };
});

describe('Performance Tests', () => {
  let repoPath: string;

  beforeEach(async () => {
    // We use real timers for performance tests to measure actual time,
    // but we mock the spawn to be fast.
    vi.useRealTimers();

    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      // Use process.nextTick to simulate async completion without real delay
      process.nextTick(() => child.emit('close', 0));
      return child;
    });

    // Create real temp directory
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'salmon-loop-perf-'));
    await fs.mkdir(path.join(repoPath, '.git'), { recursive: true });

    // Simulate a large repository with 1000 files
    const filePromises = [];
    for (let i = 0; i < 1000; i++) {
      filePromises.push(
        fs.writeFile(path.join(repoPath, `file${i}.ts`), `console.log("file ${i}");`),
      );
    }
    await Promise.all(filePromises);

    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (repoPath) {
      await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
    }
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
    vi.mocked(verify.runVerify).mockResolvedValue({ ok: true, output: '', exitCode: 0 });

    const start = Date.now();
    const result = await runSalmonLoop({
      instruction: 'Fix file0',
      verify: 'npm test',
      repoPath: repoPath,
      llm: mockLlm,
    });
    const end = Date.now();
    const durationMs = end - start;

    expect(result.success).toBe(true);
    expect(durationMs).toBeLessThan(5000);
  });
});
