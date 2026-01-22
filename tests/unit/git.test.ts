import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';

import { getGitDiff, getGitStatus, applyPatch, rollbackFiles } from '../../src/core/git.js';

vi.mock('fs/promises');
vi.mock('child_process');

describe('Git Utils', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should get git diff for unstaged changes', async () => {
    vi.mocked(spawn).mockImplementation((command: string, args: readonly string[]) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      setTimeout(() => {
        if (command === 'git' && args[0] === 'diff' && !args.includes('--cached')) {
          emitter.stdout.emit('data', Buffer.from('+modified\n-initial'));
          emitter.emit('close', 0);
        } else {
          emitter.emit('close', 0);
        }
      }, 0);

      return emitter;
    });

    const promise = getGitDiff(tempDir);
    await vi.runAllTimersAsync();
    const diff = await promise;
    expect(diff).toContain('+modified');
    expect(diff).toContain('-initial');
  });

  it('should get git diff for staged changes', async () => {
    vi.mocked(spawn).mockImplementation((command: string, args: readonly string[]) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      setTimeout(() => {
        if (command === 'git' && args[0] === 'diff' && args.includes('--cached')) {
          emitter.stdout.emit('data', Buffer.from('+staged'));
          emitter.emit('close', 0);
        } else {
          emitter.emit('close', 0);
        }
      }, 0);

      return emitter;
    });

    const promise = getGitDiff(tempDir, true);
    await vi.runAllTimersAsync();
    const diff = await promise;
    expect(diff).toContain('+staged');
  });

  it('should get git status', async () => {
    vi.mocked(spawn).mockImplementation((command: string, args: readonly string[]) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      setTimeout(() => {
        if (command === 'git' && args[0] === 'status') {
          emitter.stdout.emit('data', Buffer.from('?? new.txt'));
          emitter.emit('close', 0);
        } else {
          emitter.emit('close', 0);
        }
      }, 0);

      return emitter;
    });

    const promise = getGitStatus(tempDir);
    await vi.runAllTimersAsync();
    const status = await promise;
    expect(status).toContain('?? new.txt');
  });

  it('should apply a patch and filter index lines', async () => {
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);

    vi.mocked(spawn).mockImplementation((command: string, args: readonly string[]) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      setTimeout(() => {
        if (command === 'git' && args[0] === 'apply') {
          emitter.emit('close', 0);
        } else {
          emitter.emit('close', 0);
        }
      }, 0);

      return emitter;
    });

    const patch = `diff --git a/test.txt b/test.txt
index abc1234..def5678 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-line1
+line2
`;
    const promise = applyPatch(tempDir, patch);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.stringContaining('index abc1234..def5678'),
      'utf8',
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining([
        'apply',
        '--recount',
        '--ignore-space-change',
        '--ignore-whitespace',
      ]),
      expect.any(Object),
    );
  });

  it('should rollback specific files', async () => {
    vi.mocked(spawn).mockImplementation((command: string, args: readonly string[]) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      setTimeout(() => {
        if (command === 'git' && args[0] === 'checkout') {
          emitter.emit('close', 0);
        } else {
          emitter.emit('close', 0);
        }
      }, 0);

      return emitter;
    });

    const promise = rollbackFiles(tempDir, ['test.txt']);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['checkout', '--', 'test.txt']),
      expect.any(Object),
    );
  });

  it('should filter out Unix absolute paths', async () => {
    const promise = rollbackFiles(tempDir, ['/absolute/path.ts']);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.attempted).not.toContain('/absolute/path.ts');
  });
});
