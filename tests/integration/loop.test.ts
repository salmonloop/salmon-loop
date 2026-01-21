import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import mockFs from 'mock-fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as git from '../../src/core/git.js';
import { LLM } from '../../src/core/llm.js';
import { runSalmonLoop } from '../../src/core/loop.js';
import { ExecutionPhase } from '../../src/core/types.js';
import * as verify from '../../src/core/verify.js';
import { AstParser } from '../../src/core/ast/parser.js';
import { WorkspaceManager } from '../../src/core/workspace.js';

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

// Mock the LLM
const mockLlm = {
  createPlan: vi.fn(),
  createPatch: vi.fn(),
} as unknown as any;

// Mock git and verify modules
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

vi.mock('../../src/core/workspace.js', () => ({
  WorkspaceManager: {
    setup: vi.fn().mockImplementation(async (options) => {
      console.log('Mock WorkspaceManager.setup called with:', JSON.stringify(options));
      const workspace = {
        baseRepoPath: options.repoPath,
        workPath: options.repoPath, // Return same path to work with mockFs
        strategy: options.strategy || 'direct',
      };
      
      return workspace;
    }),
    teardown: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('SalmonLoop Integration Tests', () => {
  const repoPath = '/fake-repo';

  beforeEach(() => {
    mockFs({
      [repoPath]: {
        src: {
          'index.ts': 'console.log("hello");',
        },
        '.git': {}, // Simulate git repo
      },
    });
    vi.clearAllMocks();

    // Default spawn mock to avoid errors in ContextBuilder
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

    // Restore WorkspaceManager mock implementation
    vi.mocked(WorkspaceManager.setup).mockImplementation(async (options) => {
      // console.log('Mock WorkspaceManager.setup called with:', JSON.stringify(options));
      return {
        baseRepoPath: options.repoPath,
        workPath: options.repoPath,
        strategy: options.strategy || 'direct',
      };
    });
  });

  afterEach(() => {
    mockFs.restore();
    vi.clearAllMocks();
  });

  it('should complete a successful loop', async () => {
    // Setup mocks
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    mockLlm.createPlan.mockResolvedValue({
      goal: 'Fix the log message',
      files: ['src/index.ts'],
      changes: ['Change hello to world'],
      verify: 'npm test',
    });
    mockLlm.createPatch.mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
        '--- a/src/index.ts\n' +
        '+++ b/src/index.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("hello");\n' +
        '+console.log("world");',
    );
    vi.mocked(git.applyPatch).mockResolvedValue(undefined);
    vi.mocked(verify.runVerify).mockResolvedValue({
      ok: true,
      output: 'Tests passed',
      exitCode: 0,
    });

    const result = await runSalmonLoop({
      instruction: 'Fix the log message',
      verify: 'npm test',
      repoPath: repoPath,
      file: 'src/index.ts',
      llm: mockLlm as unknown as LLM,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(git.applyPatch).toHaveBeenCalled();
    expect(verify.runVerify).toHaveBeenCalled();
  });

  it('should fail after maximum attempts', async () => {
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    mockLlm.createPlan.mockResolvedValue({
      goal: 'Fix the log message',
      files: ['src/index.ts'],
      changes: ['Change hello to world'],
      verify: 'npm test',
    });
    mockLlm.createPatch.mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
        '--- a/src/index.ts\n' +
        '+++ b/src/index.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("hello");\n' +
        '+console.log("world");',
    );
    vi.mocked(git.applyPatch).mockResolvedValue(undefined);
    vi.mocked(verify.runVerify).mockResolvedValue({
      ok: false,
      output: 'Tests failed',
      exitCode: 1,
    });
    vi.mocked(git.rollbackFiles).mockResolvedValue({
      ok: true,
      attempted: ['src/index.ts'],
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    const result = await runSalmonLoop({
      instruction: 'Fix the log message',
      verify: 'npm test',
      repoPath: repoPath,
      file: 'src/index.ts',
      llm: mockLlm as unknown as LLM,
    });

    if (result.attempts === 0) {
      console.log('Result failure details:', JSON.stringify(result, null, 2));
    }

    expect(result.success).toBe(false);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.failurePhase).toBe(ExecutionPhase.VERIFY);
  });

  it('should use worktree strategy when requested', async () => {
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    mockLlm.createPlan.mockResolvedValue({
      goal: 'Fix the log message',
      files: ['src/index.ts'],
      changes: ['Change hello to world'],
      verify: 'npm test',
    });
    mockLlm.createPatch.mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
        '--- a/src/index.ts\n' +
        '+++ b/src/index.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("hello");\n' +
        '+console.log("world");',
    );
    vi.mocked(git.applyPatch).mockResolvedValue(undefined);
    vi.mocked(verify.runVerify).mockResolvedValue({
      ok: true,
      output: 'Tests passed',
      exitCode: 0,
    });

    const result = await runSalmonLoop({
      instruction: 'Fix the log message',
      verify: 'npm test',
      repoPath: repoPath,
      file: 'src/index.ts',
      llm: mockLlm as unknown as LLM,
      strategy: 'worktree',
    });

    if (!result.success) {
      console.log('Worktree test failure details:', JSON.stringify(result, null, 2));
    }

    expect(result.success).toBe(true);
    // Since spawn is mocked to return 0, WorkspaceManager should succeed
    // We can verify that the loop ran successfully
  });
});
