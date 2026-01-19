import { runVerify, classifyError, preflight } from '../../src/core/verify.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { ErrorType } from '../../src/core/types.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('Verify Integration Tests', () => {
  const repoPath = '/fake-repo';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockSpawn(exitCode: number, stdout = '', stderr = '') {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    
    vi.mocked(spawn).mockReturnValue(child);

    setTimeout(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    }, 10);

    return child;
  }

  it('should run verify command successfully', async () => {
    mockSpawn(0, 'All tests passed');

    const result = await runVerify(repoPath, 'npm test');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('All tests passed');
    expect(spawn).toHaveBeenCalledWith(
      'npm test',
      expect.objectContaining({ shell: true, cwd: repoPath })
    );
  });

  it('should fail when verify command returns non-zero exit code', async () => {
    mockSpawn(1, 'Tests failed');

    const result = await runVerify(repoPath, 'npm test');

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Tests failed');
  });

  it('should classify errors correctly', () => {
    expect(classifyError('TS2322: Type string is not assignable to type number')).toBe(ErrorType.COMPILATION);
    expect(classifyError('failed to compile')).toBe(ErrorType.COMPILATION);
    expect(classifyError('ESLint found 5 errors')).toBe(ErrorType.LINT);
    expect(classifyError('Test suites: 1 failed, 1 total')).toBe(ErrorType.TEST);
    expect(classifyError('AssertionError: expected 1 to be 2')).toBe(ErrorType.TEST);
    expect(classifyError('Some random error')).toBe(ErrorType.LOGIC);
  });

  it('should perform preflight checks', async () => {
    // 1. git rev-parse
    const gitCheck = new EventEmitter() as any;
    gitCheck.stdout = new EventEmitter();
    gitCheck.stderr = new EventEmitter();
    // 2. git status
    const statusCheck = new EventEmitter() as any;
    statusCheck.stdout = new EventEmitter();
    statusCheck.stderr = new EventEmitter();
    // 3. rg --version
    const rgCheck = new EventEmitter() as any;
    rgCheck.stdout = new EventEmitter();
    rgCheck.stderr = new EventEmitter();

    vi.mocked(spawn)
      .mockReturnValueOnce(gitCheck)
      .mockReturnValueOnce(statusCheck)
      .mockReturnValueOnce(rgCheck);

    setTimeout(() => {
      gitCheck.emit('close', 0);
      setTimeout(() => {
        statusCheck.stdout.emit('data', Buffer.from(''));
        statusCheck.emit('close', 0);
        setTimeout(() => {
          rgCheck.emit('close', 0);
        }, 5);
      }, 5);
    }, 5);

    const result = await preflight(repoPath);
    expect(result.ok).toBe(true);
  });

  it('should fail preflight if not a git repo', async () => {
    const gitCheck = new EventEmitter() as any;
    vi.mocked(spawn).mockReturnValueOnce(gitCheck);

    setTimeout(() => {
      gitCheck.emit('close', 128);
    }, 5);

    const result = await preflight(repoPath);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Not a git repository');
  });
});
