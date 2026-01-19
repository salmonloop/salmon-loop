import { runSalmonLoop } from '../../src/core/loop.js';
import { LLM } from '../../src/core/llm.js';
import { ExecutionPhase } from '../../src/core/types.js';
import * as git from '../../src/core/git.js';
import * as verify from '../../src/core/verify.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import mockFs from 'mock-fs';
import { join } from 'path';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock the LLM
const mockLlm = {
  createPlan: vi.fn(),
  createPatch: vi.fn(),
} as unknown as LLM;

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

describe('SalmonLoop Integration Tests', () => {
  const repoPath = '/fake-repo';

  beforeEach(() => {
    mockFs({
      [repoPath]: {
        'src': {
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
      setTimeout(() => child.emit('close', 0), 10);
      return child;
    });
  });

  afterEach(() => {
    mockFs.restore();
  });

  it('should complete a successful loop', async () => {
    // Setup mocks
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    vi.mocked(mockLlm.createPlan).mockResolvedValue({
      goal: 'Fix the log message',
      files: ['src/index.ts'],
      changes: ['Change hello to world'],
      verify: 'npm test',
    });
    vi.mocked(mockLlm.createPatch).mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
      '--- a/src/index.ts\n' +
      '+++ b/src/index.ts\n' +
      '@@ -1,1 +1,1 @@\n' +
      '-console.log("hello");\n' +
      '+console.log("world");'
    );
    vi.mocked(git.applyPatch).mockResolvedValue(undefined);
    vi.mocked(verify.runVerify).mockResolvedValue({
      ok: true,
      output: 'Tests passed',
      exitCode: 0,
    });

    const result = await runSalmonLoop({
      instruction: 'Change hello to world',
      verify: 'npm test',
      repoPath: repoPath,
      llm: mockLlm,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.reasonCode).toBe('SUCCESS');
    expect(vi.mocked(git.applyPatch)).toHaveBeenCalled();
    expect(vi.mocked(verify.runVerify)).toHaveBeenCalledWith(repoPath, 'npm test');
  });

  it('should retry and succeed on second attempt', async () => {
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    vi.mocked(mockLlm.createPlan).mockResolvedValue({
      goal: 'Fix it',
      files: [],
      changes: [],
      verify: 'npm test',
    });
    vi.mocked(mockLlm.createPatch).mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
      '--- a/src/index.ts\n' +
      '+++ b/src/index.ts\n' +
      '@@ -1,1 +1,1 @@\n' +
      '-console.log("hello");\n' +
      '+console.log("world");'
    );
    
    // First attempt fails verification
    vi.mocked(verify.runVerify)
      .mockResolvedValueOnce({
        ok: false,
        output: 'Test failed: expected world but got hello',
        exitCode: 1,
      })
      // Second attempt succeeds
      .mockResolvedValueOnce({
        ok: true,
        output: 'Tests passed',
        exitCode: 0,
      });

    vi.mocked(git.rollbackFiles).mockResolvedValue({
      ok: true,
      attempted: ['src/index.ts'],
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    const result = await runSalmonLoop({
      instruction: 'Fix it',
      verify: 'npm test',
      repoPath: repoPath,
      llm: mockLlm,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(vi.mocked(git.rollbackFiles)).toHaveBeenCalled();
  });

  it('should fail after max retries', async () => {
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    vi.mocked(mockLlm.createPlan).mockResolvedValue({
      goal: 'Fix it',
      files: [],
      changes: [],
      verify: 'npm test',
    });
    vi.mocked(mockLlm.createPatch).mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
      '--- a/src/index.ts\n' +
      '+++ b/src/index.ts\n' +
      '@@ -1,1 +1,1 @@\n' +
      '-console.log("hello");\n' +
      '+console.log("world");'
    );
    
    vi.mocked(verify.runVerify).mockResolvedValue({
      ok: false,
      output: 'Still failing',
      exitCode: 1,
    });

    vi.mocked(git.rollbackFiles).mockResolvedValue({
      ok: true,
      attempted: [],
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    const result = await runSalmonLoop({
      instruction: 'Fix it',
      verify: 'npm test',
      repoPath: repoPath,
      llm: mockLlm,
    });

    expect(result.success).toBe(false);
    if (result.reasonCode !== 'MAX_RETRIES') {
      console.log('Result:', JSON.stringify(result, null, 2));
    }
    expect(result.reasonCode).toBe('MAX_RETRIES');
    expect(result.attempts).toBe(3); // Default maxRetries is 2, so 3 attempts total
  });

  it('should handle preflight failure (dirty repo)', async () => {
    vi.mocked(verify.preflight).mockResolvedValue({
      ok: false,
      reason: 'Workspace is dirty',
    });

    const result = await runSalmonLoop({
      instruction: 'Fix it',
      verify: 'npm test',
      repoPath: repoPath,
      llm: mockLlm,
    });

    expect(result.success).toBe(false);
    expect(result.failurePhase).toBe(ExecutionPhase.PREFLIGHT);
    expect(result.reason).toBe('Workspace is dirty');
  });
});
