import { PluginLoader } from '../../src/core/plugin/loader.js';
import { ErrorType } from '../../src/core/types/index.js';
import { runVerify, classifyError, preflight } from '../../src/core/verification/runner.js';
import { buildBunCommand } from '../helpers/bun.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Verify Integration Tests with Real FS', () => {
  const helper = new RealFsTestHelper();
  const bunCommand = (args: string) => buildBunCommand(args);
  let repoPath: string;

  beforeAll(async () => {
    await PluginLoader.loadPlugins();
  });

  beforeEach(async () => {
    const repo = await helper.createGitRepo();
    repoPath = repo.path;
    mock.clearAllMocks();
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('should run verify command successfully with real process', async () => {
    // Run a real bun process with a successful exit code.
    const result = await runVerify(repoPath, bunCommand('-e "console.log(\'All tests passed\')"'));

    expect(result.ok).toBe(true);
    expect(result.output).toContain('All tests passed');
    expect(result.exitCode).toBe(0);
  });

  it('should fail when verify command returns non-zero exit code', async () => {
    // Run a real bun process with a failing exit code.
    const result = await runVerify(repoPath, bunCommand('-e "process.exit(1)"'));

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('should classify errors correctly', () => {
    expect(classifyError('TS2322: Type string is not assignable to type number')).toBe(
      ErrorType.COMPILATION,
    );
    expect(classifyError('failed to compile')).toBe(ErrorType.COMPILATION);
    expect(classifyError('ESLint found 5 errors')).toBe(ErrorType.LINT);
    expect(classifyError('Test suites: 1 failed, 1 total')).toBe(ErrorType.TEST);
    expect(classifyError('AssertionError: expected 1 to be 2')).toBe(ErrorType.TEST);
    expect(classifyError('Some random error')).toBe(ErrorType.LOGIC);
  });

  it('should perform preflight checks on real git repo', async () => {
    const result = await preflight({
      baseRepoPath: repoPath,
      workPath: repoPath,
      strategy: 'direct',
    });

    expect(result.ok).toBe(true);
  });

  it('should allow dirty preflight when ignoreDirty is enabled', async () => {
    // Make repo dirty by adding an uncommitted file.
    await helper.writeFile(repoPath, 'dirty.txt', 'dirty');

    const result = await preflight(
      {
        baseRepoPath: repoPath,
        workPath: repoPath,
        strategy: 'direct',
      },
      undefined,
      { ignoreDirty: true },
    );

    expect(result.ok).toBe(true);
  });

  it('should fail preflight if not a git repo', async () => {
    // Create a non-git directory.
    const nonGitDir = await helper.createTempDir('not-a-repo-');

    const result = await preflight({
      baseRepoPath: nonGitDir,
      workPath: nonGitDir,
      strategy: 'direct',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Not a git repository|untracked/);
  });
});
