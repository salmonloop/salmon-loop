import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import mockFs from 'mock-fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as git from '../../src/core/git.js';
import { LLM } from '../../src/core/llm.js';
import { runSalmonLoop } from '../../src/core/loop.js';
import * as verify from '../../src/core/verify.js';
import { AstParser } from '../../src/core/ast/parser.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../src/core/ast/parser.js', () => ({
  AstParser: class {
    static parse = vi.fn();
    static identifyDefinitions = vi.fn();
    static identifyReferences = vi.fn();
  },
}));

const mockLlm = {
  createPlan: vi.fn(),
  createPatch: vi.fn(),
} as unknown as any;

vi.mock('../../src/core/git.js', async () => {
  const actual = await vi.importActual('../../src/core/git.js');
  return {
    ...actual,
    applyPatch: vi.fn(),
    rollbackFiles: vi.fn(),
    getGitStatus: vi.fn(),
    getGitDiff: vi.fn(),
  };
});

vi.mock('../../src/core/verify.js', async () => {
  const actual = await vi.importActual('../../src/core/verify.js');
  return {
    ...actual,
    runVerify: vi.fn(),
    preflight: vi.fn(),
  };
});

describe('Fuzzy Patch Loop Integration', () => {
  const repoPath = '/fake-repo';

  beforeEach(() => {
    mockFs({
      [repoPath]: {
        'app.js': 'function main() {\n  console.log("start");\n}',
        '.git': {},
      },
    });
    vi.clearAllMocks();

    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      (child.stdin as any).end = vi.fn();
      (child.stdin as any).write = vi.fn();
      child.kill = vi.fn();
      // Simulate process exit in next tick to allow listeners to be attached
      process.nextTick(() => {
        child.emit('close', 0);
        child.emit('exit', 0);
      });
      return child;
    });

    vi.mocked(git.getGitStatus).mockResolvedValue('');
    vi.mocked(git.getGitDiff).mockResolvedValue('');
    vi.mocked(AstParser.parse).mockResolvedValue({} as any);
    vi.mocked(AstParser.identifyDefinitions).mockResolvedValue([]);
    vi.mocked(AstParser.identifyReferences).mockResolvedValue([]);
  });

  afterEach(() => {
    mockFs.restore();
    vi.restoreAllMocks();
  });

  it('should succeed when patch has minor formatting differences (fuzzy match)', async () => {
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    mockLlm.createPlan.mockResolvedValue({
      goal: 'Update log message',
      files: ['app.js'],
      changes: ['Change start to begin'],
      verify: 'node app.js',
    });

    // LLM generates a patch with extra space in context line
    const fuzzyPatch = 
      'diff --git a/app.js b/app.js\n' +
      '--- a/app.js\n' +
      '+++ b/app.js\n' +
      '@@ -1,3 +1,3 @@\n' +
      ' function main() { \n' + // Extra space here
      '-  console.log("start");\n' +
      '+  console.log("begin");\n' +
      ' }';

    mockLlm.createPatch.mockResolvedValue(fuzzyPatch);
    vi.mocked(git.applyPatch).mockResolvedValue(undefined);
    vi.mocked(verify.runVerify).mockResolvedValue({
      ok: true,
      output: 'Success',
      exitCode: 0,
    });

    const result = await runSalmonLoop({
      instruction: 'Update log message',
      verify: 'node app.js',
      repoPath: repoPath,
      file: 'app.js',
      llm: mockLlm as unknown as LLM,
    });

    expect(result.success).toBe(true);
    expect(git.applyPatch).toHaveBeenCalled();
  }, 10000);
});
