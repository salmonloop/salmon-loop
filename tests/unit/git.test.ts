import { getGitDiff, getGitStatus, applyPatch, rollbackFiles } from '../../src/core/git.js';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

vi.mock('fs/promises');
vi.mock('child_process');

describe('Git Utils', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    vi.clearAllMocks();
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

    const diff = await getGitDiff(tempDir);
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

    const diff = await getGitDiff(tempDir, true);
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

    const status = await getGitStatus(tempDir);
    expect(status).toContain('?? new.txt');
  });

  it('should apply a patch', async () => {
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
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-line1
+line2
`;
    await expect(applyPatch(tempDir, patch)).resolves.toBeUndefined();
    expect(fs.writeFile).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith('git', expect.arrayContaining(['apply']), expect.any(Object));
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

    const result = await rollbackFiles(tempDir, ['test.txt']);
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith('git', expect.arrayContaining(['checkout', '--', 'test.txt']), expect.any(Object));
  });
});
