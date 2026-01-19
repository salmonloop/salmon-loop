import { rollbackFiles } from '../../src/core/git.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('Rollback Integration Tests', () => {
  const repoPath = '/fake-repo';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockSpawn(exitCode: number, stdout = '', stderr = '') {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    
    vi.mocked(spawn).mockReturnValue(child);

    setTimeout(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    }, 10);

    return child;
  }

  it('should return ok: false when git checkout fails', async () => {
    mockSpawn(1, '', 'error: pathspec file1.ts did not match any file(s) known to git');

    const result = await rollbackFiles(repoPath, ['file1.ts']);

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('error: pathspec file1.ts');
  });

  it('should handle spawn error during rollback', async () => {
    const child = new EventEmitter() as any;
    vi.mocked(spawn).mockReturnValue(child);

    setTimeout(() => {
      child.emit('error', new Error('spawn ENOENT'));
    }, 5);

    const result = await rollbackFiles(repoPath, ['file1.ts']);

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('spawn ENOENT');
  });
});
