import { describe, it, expect, vi, beforeEach, afterEach, MockInstance } from 'vitest';
// Mock storage
const mockLocks = new Set<string>();
const mockLockContents = new Map<string, string>();
type NextTickParams = Parameters<typeof process.nextTick>;
type KillParams = Parameters<typeof process.kill>;
let nextTickSpy: MockInstance<NextTickParams, ReturnType<typeof process.nextTick>> | undefined;
let killSpy: MockInstance<KillParams, ReturnType<typeof process.kill>> | undefined;

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

let spawnMock: ReturnType<typeof vi.fn> | undefined;
let applyPatch: typeof import('../../src/core/git.js').applyPatch;

const setupGitMocks = async () => {
  const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  spawnMock = vi.fn();

  vi.doMock('child_process', () => ({
    spawn: spawnMock,
  }));

  vi.doMock('fs/promises', async () => {
    const open = vi.fn(async (filePath: string, flags: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('.salmon.lock') && flags.includes('x')) { 
        if (mockLocks.has(filePath)) {
          const err: any = new Error('EEXIST');
          err.code = 'EEXIST';
          throw err;
        }
        mockLocks.add(filePath);
        if (!mockLockContents.has(filePath)) {
          mockLockContents.set(
            filePath,
            JSON.stringify({ pid: process.pid, timestamp: Date.now(), owner: `process-${process.pid}` }),
          );
        }
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
    });

    const unlink = vi.fn(async (filePath: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('.salmon.lock')) {
        mockLocks.delete(filePath);
        mockLockContents.delete(filePath);
        return;
      }
    });

    const readFile = vi.fn(async (filePath: string, encoding: any) => {
      if (typeof filePath === 'string' && filePath.endsWith('.salmon.lock')) {
        return (
          mockLockContents.get(filePath) ??
          JSON.stringify({ pid: process.pid, timestamp: Date.now(), owner: `process-${process.pid}` })
        );
      }
      return actualFs.readFile(filePath, encoding as any);
    });

    const stat = vi.fn(async (filePath: string) => {
      if (typeof filePath === 'string' && filePath.endsWith('.salmon.lock')) {
        return { mtimeMs: Date.now() };
      }
      return actualFs.stat(filePath);
    });

    const writeFile = vi.fn(async () => undefined);
    const mkdir = vi.fn(async (...args: any[]) => (actualFs as any).mkdir(...args));
    const rm = vi.fn(async (...args: any[]) => (actualFs as any).rm(...args));

    return {
      ...actualFs,
      open,
      unlink,
      readFile,
      stat,
      writeFile,
      mkdir,
      rm,
      default: {
        ...(actualFs as any).default,
        open,
        unlink,
        readFile,
        stat,
        writeFile,
        mkdir,
        rm,
      },
    };
  });

  ({ applyPatch } = await import('../../src/core/git.js'));
};

describe('Race Conditions & Concurrency', () => {
  const testRepoPath = 'virtual-repo';

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    const nextTickImpl = vi.fn((cb: (...args: any[]) => void, ...args: any[]) => {
      queueMicrotask(() => cb(...args));
    });
    nextTickSpy = vi
      .spyOn(process, 'nextTick')
      .mockImplementation(nextTickImpl as unknown as typeof process.nextTick);
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    process.env.SALMON_ENABLE_LOCK_IN_TEST = 'true';
    mockLocks.clear();
    mockLockContents.clear();
  });

  afterEach(async () => {
    delete process.env.SALMON_ENABLE_LOCK_IN_TEST;
    vi.unmock('web-tree-sitter');
    vi.unmock('fs/promises');
    vi.unmock('child_process');
    nextTickSpy?.mockRestore();
    nextTickSpy = undefined;
    killSpy?.mockRestore();
    killSpy = undefined;
    spawnMock = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  describe('AstParser.init() Concurrency', () => {
    it('should handle concurrent init() calls gracefully', async () => {
      vi.resetModules();
      vi.doMock('web-tree-sitter', mockTreeSitter);
      const { AstParser } = await import('../../src/core/ast/parser.js');
      const results = await Promise.all([
        AstParser.init(),
        AstParser.init(),
        AstParser.init()
      ]);
      expect(results).toHaveLength(3);
    });
  });

  describe('File Locking Concurrency', () => {
    it('should prevent concurrent applyPatch calls on the same repo', async () => {
      vi.resetModules();
      await setupGitMocks();
      const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new';

      let activeCount = 0;
      let maxActive = 0;
      const executions: Array<{ id: number; start: number; end: number }> = [];

      const closeDelayMs = 50;

      // Override spawn mock to track concurrency with fake timers
      spawnMock?.mockImplementation((command, args, options) => {
        const id = executions.length;
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        executions.push({ id, start: Date.now(), end: Date.now() });
        const child = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: (event: string, cb: any) => {
            if (event === 'close') {
              setTimeout(() => {
                executions[id].end = Date.now();
                if (typeof cb === 'function') cb(0);
                activeCount--;
              }, closeDelayMs);
            }
            return child;
          },
          kill: vi.fn(),
        };
        return child as any;
      });

      const errors: any[] = [];
      let p1Done = false;
      let p2Done = false;
      const p1 = applyPatch(testRepoPath, patch)
        .then(() => {
          p1Done = true;
        })
        .catch((e) => errors.push('p1:' + e));
      const p2 = applyPatch(testRepoPath, patch)
        .then(() => {
          p2Done = true;
        })
        .catch((e) => errors.push('p2:' + e));

      // Step fake time forward until both operations complete.
      for (let i = 0; i < 10 && (!p1Done || !p2Done); i++) {
        await vi.advanceTimersByTimeAsync(100);
        await Promise.resolve();
      }

      await Promise.all([p1, p2]);

      expect(errors).toHaveLength(0);

      // Verify serial execution
      expect(maxActive).toBeLessThanOrEqual(1);
      expect(executions).toHaveLength(2);
    });
  });
});
