import { mock } from 'bun:test';

import { LIMITS } from '../../src/core/config/limits.js';

// Mock storage
const mockLocks = new Set<string>();
const mockLockContents = new Map<string, string>();
const spawnMock = mock();

let nextTickSpy: { mockRestore: () => void } | undefined;
let killSpy: { mockRestore: () => void } | undefined;

// Mock dependencies at top level
mock.module('child_process', () => ({
  spawn: mock((...args: any[]) => spawnMock(...args)),
}));

mock.module('../../src/core/adapters/git/git-runner.js', () => ({
  runGitCommand: mock(),
}));

mock.module('fs/promises', () => {
  return {
    open: mock(async (filePath: string, flags: string) => {
      if (
        typeof filePath === 'string' &&
        filePath.endsWith('.salmonloop.lock') &&
        flags.includes('x')
      ) {
        if (mockLocks.has(filePath)) {
          const err: any = new Error('EEXIST');
          err.code = 'EEXIST';
          throw err;
        }
        mockLocks.add(filePath);
        return {
          writeFile: mock(async (contents: string) => {
            mockLockContents.set(filePath, contents);
          }),
          close: mock(),
        };
      }
      return {
        writeFile: mock(),
        close: mock(),
      };
    }),
    unlink: mock(async (filePath: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('.salmonloop.lock')) {
        mockLocks.delete(filePath);
        mockLockContents.delete(filePath);
        return undefined;
      }
      return undefined;
    }),
    readFile: mock(async (filePath: string, _encoding: any) => {
      if (typeof filePath === 'string' && filePath.endsWith('.salmonloop.lock')) {
        return (
          mockLockContents.get(filePath) ??
          JSON.stringify({
            pid: process.pid,
            timestamp: Date.now(),
            owner: `process-${process.pid}`,
          })
        );
      }
      return '';
    }),
    stat: mock(async (filePath: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('.salmonloop.lock')) {
        return { mtimeMs: Date.now() };
      }
      return { mtimeMs: Date.now() };
    }),
    mkdir: mock(async () => undefined),
    rm: mock(async () => undefined),
    writeFile: mock(async () => undefined),
  };
});

const mockTreeSitter = () => {
  const Parser = mock().mockImplementation(() => ({
    setLanguage: mock(),
    parse: mock(),
  }));
  (Parser as any).init = mock().mockResolvedValue(undefined);

  return {
    default: {
      init: mock().mockResolvedValue(undefined),
      Parser,
      Language: { load: mock().mockResolvedValue({}) },
      Query: mock().mockImplementation(() => ({
        captures: mock().mockReturnValue([]),
      })),
    },
    Parser,
    Language: { load: mock().mockResolvedValue({}) },
    Query: mock().mockImplementation(() => ({
      captures: mock().mockReturnValue([]),
    })),
  };
};

describe('Race Conditions & Concurrency', () => {
  // Save original limits
  const originalWorktreeTimeout = LIMITS.worktreePrepareTimeoutMs;

  beforeEach(async () => {
    // We will use REAL timers but short delays to avoid flaky fake timer issues with async loops
    killSpy = spyOn(process, 'kill').mockImplementation(() => true);
    process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST = 'true';
    mockLocks.clear();
    mockLockContents.clear();
    spawnMock.mockReset();

    // Set a very short timeout for tests to run fast
    (LIMITS as any).worktreePrepareTimeoutMs = 500;
    (LIMITS as any).lockWaitTimeoutMs = 500;
    (LIMITS as any).lockStaleThresholdMs = 200;
    (LIMITS.retry.io as any).initialDelayMs = 10;
  });

  afterEach(async () => {
    delete process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST;
    killSpy?.mockRestore();
    nextTickSpy?.mockRestore();
    (LIMITS as any).worktreePrepareTimeoutMs = originalWorktreeTimeout;
  });

  describe('AstParser.init() Concurrency', () => {
    it('should handle concurrent init() calls gracefully', async () => {
      mock.module('web-tree-sitter', mockTreeSitter);
      const { AstParser } = await import('../../src/core/ast/parser.js');
      const results = await Promise.all([AstParser.init(), AstParser.init(), AstParser.init()]);
      expect(results).toHaveLength(3);
    });
  });

  describe('File Locking Concurrency', () => {
    it('should prevent concurrent applyPatch calls on the same repo', async () => {
      const { GitAdapter } = await import('../../src/core/adapters/git/git-adapter.js');
      const { runGitCommand } = await import('../../src/core/adapters/git/git-runner.js');
      const adapter = new GitAdapter('virtual-repo');

      const patch =
        'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new';

      let activeCount = 0;
      let maxActive = 0;
      const executions: Array<{ id: number; start: number; end: number }> = [];

      const runGit = runGitCommand as any;
      runGit.mockImplementation(async () => {
        const id = executions.length;
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        const startTime = Date.now();
        executions.push({ id, start: startTime, end: 0 });

        await new Promise((resolve) => setTimeout(resolve, 20));

        executions[id].end = Date.now();
        activeCount--;

        return {
          ok: true,
          code: 0,
          signal: null,
          stdout: Buffer.from(''),
          stderr: '',
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      });

      const errors: any[] = [];
      // Trigger both concurrently
      const p1 = adapter.applyPatch(patch).catch((e: unknown) => {
        errors.push('p1:' + String(e));
        throw e;
      });
      const p2 = adapter.applyPatch(patch).catch((e: unknown) => {
        errors.push('p2:' + String(e));
        throw e;
      });

      await Promise.all([p1, p2]);

      expect(errors).toHaveLength(0);
      expect(maxActive).toBe(1); // Crucial: serial execution
      expect(executions).toHaveLength(2);

      // Verify they didn't overlap in time
      const [e1, e2] = executions.sort((a, b) => a.start - b.start);
      expect(e1.end).toBeLessThanOrEqual(e2.start);
    }, 10000);
  });
});
