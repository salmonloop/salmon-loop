import type { MockInstance } from 'vitest';

import { LIMITS } from '../../src/core/config/limits.js';

// Mock storage
const mockLocks = new Set<string>();
const mockLockContents = new Map<string, string>();
const spawnMock = vi.fn();

type NextTickParams = Parameters<typeof process.nextTick>;
type KillParams = Parameters<typeof process.kill>;
let nextTickSpy: MockInstance<NextTickParams, ReturnType<typeof process.nextTick>> | undefined;
let killSpy: MockInstance<KillParams, ReturnType<typeof process.kill>> | undefined;

// Mock dependencies at top level
vi.mock('child_process', () => ({
  spawn: vi.fn((...args: any[]) => spawnMock(...args)),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    open: vi.fn(async (filePath: string, flags: string) => {
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
          writeFile: vi.fn(async (contents: string) => {
            mockLockContents.set(filePath, contents);
          }),
          close: vi.fn(),
        };
      }
      return {
        writeFile: vi.fn(),
        close: vi.fn(),
      };
    }),
    unlink: vi.fn(async (filePath: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('.salmonloop.lock')) {
        mockLocks.delete(filePath);
        mockLockContents.delete(filePath);
        return;
      }
      return actual.unlink(filePath);
    }),
    readFile: vi.fn(async (filePath: string, encoding: any) => {
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
      return actual.readFile(filePath, encoding);
    }),
    stat: vi.fn(async (filePath: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('.salmonloop.lock')) {
        return { mtimeMs: Date.now() };
      }
      return actual.stat(filePath);
    }),
    mkdir: vi.fn(async (...args: any[]) => actual.mkdir(...args)),
    rm: vi.fn(async (...args: any[]) => actual.rm(...args)),
    writeFile: vi.fn(async () => undefined),
  };
});

const mockTreeSitter = () => {
  const Parser = vi.fn().mockImplementation(() => ({
    setLanguage: vi.fn(),
    parse: vi.fn(),
  }));
  (Parser as any).init = vi.fn().mockResolvedValue(undefined);

  return {
    default: {
      init: vi.fn().mockResolvedValue(undefined),
      Parser,
      Language: { load: vi.fn().mockResolvedValue({}) },
      Query: vi.fn().mockImplementation(() => ({
        captures: vi.fn().mockReturnValue([]),
      })),
    },
    Parser,
    Language: { load: vi.fn().mockResolvedValue({}) },
    Query: vi.fn().mockImplementation(() => ({
      captures: vi.fn().mockReturnValue([]),
    })),
  };
};

describe('Race Conditions & Concurrency', () => {
  // Save original limits
  const originalWorktreeTimeout = LIMITS.worktreePrepareTimeoutMs;

  beforeEach(async () => {
    // We will use REAL timers but short delays to avoid flaky fake timer issues with async loops
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
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
      vi.doMock('web-tree-sitter', mockTreeSitter);
      const { AstParser } = await import('../../src/core/ast/parser.js');
      const results = await Promise.all([AstParser.init(), AstParser.init(), AstParser.init()]);
      expect(results).toHaveLength(3);
    });
  });

  describe('File Locking Concurrency', () => {
    it('should prevent concurrent applyPatch calls on the same repo', async () => {
      const { GitAdapter } = await import('../../src/core/adapters/git/git-adapter.js');
      const adapter = new GitAdapter('virtual-repo');

      const patch =
        'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new';

      let activeCount = 0;
      let maxActive = 0;
      const executions: Array<{ id: number; start: number; end: number }> = [];

      const closeDelayMs = 20;

      spawnMock.mockImplementation((_command, _args, _options) => {
        const id = executions.length;
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        const startTime = Date.now();
        executions.push({ id, start: startTime, end: 0 });

        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          stdin: { write: vi.fn(), end: vi.fn() },
          on: (event: string, cb: any) => {
            if (event === 'close') {
              setTimeout(() => {
                executions[id].end = Date.now();
                activeCount--;
                if (typeof cb === 'function') cb(0);
              }, closeDelayMs);
            }
          },
          kill: vi.fn(),
        } as any;
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
