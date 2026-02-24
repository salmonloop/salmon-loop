import { execFileSync } from 'child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir, rename, chmod, cp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { logger } from '../../src/core/observability/logger.js';
import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';
import { ShadowMergeEngine } from '../../src/core/strata/engine/shadow-merge-engine.js';

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getErrorStderr(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return '';
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === 'string') return stderr;
  if (Buffer.isBuffer(stderr)) return stderr.toString();
  return stderr ? String(stderr) : '';
}

const canUseSyncGit = (() => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });
    // Probe a few sync git invocations to avoid false positives on constrained runtimes.
    for (let i = 0; i < 6; i++) {
      execFileSync('git', ['status', '--porcelain'], {
        cwd: process.cwd(),
        stdio: 'ignore',
      });
    }
    return true;
  } catch (error: unknown) {
    if (getErrorCode(error) === 'EPERM' || getErrorCode(error) === 'EACCES') {
      return false;
    }
    throw error;
  }
})();

const describeMerge = canUseSyncGit ? describe : describe.skip;

class GitHelper {
  constructor(public cwd: string) {}

  private splitCommand(command: string): string[] {
    const parts: string[] = [];
    const tokenPattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(command)) !== null) {
      parts.push(match[1] ?? match[2] ?? match[0]);
    }
    return parts;
  }

  private sanitizedEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    return env;
  }

  run(command: string): string {
    let retries = 0;
    const maxRetries = 5;

    while (true) {
      try {
        const result = execFileSync('git', this.splitCommand(command), {
          cwd: this.cwd,
          stdio: 'pipe',
          env: this.sanitizedEnv(),
        }).toString();
        return result;
      } catch (error: unknown) {
        // Check for lock file errors
        const stderr = getErrorStderr(error);
        if (
          (stderr.includes('index.lock') || stderr.includes('lock file')) &&
          retries < maxRetries
        ) {
          retries++;
          // Sync sleep for retry
          const end = Date.now() + 100 * Math.pow(2, retries);
          while (Date.now() < end) {
            /* busy wait */
          }
          continue;
        }

        throw new Error(`Git command failed: git ${command}\n${stderr || getErrorMessage(error)}`);
      }
    }
  }

  runWithInput(command: string, input: string | Buffer): string {
    try {
      return execFileSync('git', this.splitCommand(command), {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        input,
        env: this.sanitizedEnv(),
      }).toString();
    } catch (error: unknown) {
      throw new Error(
        `Git command failed: git ${command}\n${getErrorStderr(error) || getErrorMessage(error)}`,
      );
    }
  }

  async init() {
    try {
      const inside = this.run('rev-parse --is-inside-work-tree').trim();
      if (inside === 'true') {
        this.run('config user.email "test@example.com"');
        this.run('config user.name "Test User"');
        this.run('config core.autocrlf false');
        return;
      }
    } catch {
      // Not a repo yet; continue with initialization.
    }

    // Retry git init
    let retries = 0;
    let lastError: unknown = null;
    let initialized = false;
    while (retries < 5) {
      try {
        execFileSync('git', ['init', '--initial-branch=main'], {
          cwd: this.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: this.sanitizedEnv(),
        });
        initialized = true;
        break;
      } catch (e) {
        lastError = e;
      }

      retries++;
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, retries)));
    }
    if (!initialized) {
      throw new Error(
        `Failed to initialize git repository after 5 attempts. Last error: ${lastError ? getErrorMessage(lastError) : 'unknown'}`,
      );
    }

    this.run('config user.email "test@example.com"');
    this.run('config user.name "Test User"');
    this.run('config core.autocrlf false');
    // Ensure an initial commit exists so HEAD is valid.
    await writeFile(join(this.cwd, '.gitignore'), '');
    this.run('add .gitignore');
    this.run('commit -m "initial commit"');
  }

  async commit(message: string): Promise<string> {
    this.run(`commit -am "${message}"`);
    return this.run('rev-parse HEAD').trim();
  }

  async add(path: string) {
    this.run(`add "${path}"`);
  }

  async reset(mode: 'mixed' | 'soft' | 'hard' = 'mixed', ref: string = 'HEAD') {
    const modeFlag = mode === 'mixed' ? '' : `--${mode}`;
    const args = ['reset', modeFlag, ref].filter(Boolean).join(' ');
    this.run(args);
  }

  hashObject(content: string | Buffer): string {
    return this.runWithInput('hash-object -w --stdin', content).trim();
  }

  updateIndex(path: string, content: string | Buffer, mode: string = '100644') {
    const hash = this.hashObject(content);
    this.run(`update-index --add --cacheinfo ${mode} ${hash} "${path}"`);
  }

  removeFromIndex(path: string) {
    this.run(`update-index --force-remove -- "${path}"`);
  }

  getIndexMode(path: string): string | null {
    const output = this.run(`ls-files -s -- "${path}"`).trim();
    if (!output) return null;
    return output.split(/\s+/)[0] || null;
  }

  async getHead(): Promise<string> {
    return this.run('rev-parse HEAD').trim();
  }

  async show(spec: string): Promise<string> {
    return this.run(`show ${spec}`);
  }

  private parseStatus(
    output: string,
  ): Array<{ path: string; index: string; working: string; raw: string }> {
    const trimmed = output.trimEnd();
    if (!trimmed) return [];
    return trimmed.split(/\r?\n/).map((line) => ({
      raw: line,
      index: line[0] ?? ' ',
      working: line[1] ?? ' ',
      path: line.length > 3 ? line.slice(3) : '',
    }));
  }

  statusEntries(): Array<{ path: string; index: string; working: string; raw: string }> {
    return this.parseStatus(this.run('status --porcelain'));
  }

  statusEntry(path: string): { path: string; index: string; working: string; raw: string } | null {
    return this.statusEntries().find((entry) => entry.path === path) ?? null;
  }

  statusEntryForPath(
    path: string,
  ): { path: string; index: string; working: string; raw: string } | null {
    const entries = this.parseStatus(this.run(`status --porcelain -- "${path}"`));
    return entries[0] ?? null;
  }
}

class MergeTestContext {
  public mainRepoPath!: string;
  public shadowRepoPath!: string;
  public git!: GitHelper;
  public shadowGit!: GitHelper;

  // Static template repo to speed up tests (created once per test file)
  private static templatePath: string | null = null;

  static async prepareTemplate() {
    if (this.templatePath) return;

    const baseDir = join(tmpdir(), 'salmon-merge-template-');
    this.templatePath = await mkdtemp(baseDir);

    const git = new GitHelper(this.templatePath);
    // GitHelper.init() already handles retries, config, and the initial commit.
    await git.init();
  }

  static async cleanupTemplate() {
    if (this.templatePath) {
      await rm(this.templatePath, { recursive: true, force: true });
      this.templatePath = null;
    }
  }

  async setup() {
    const baseDir = join(tmpdir(), 'salmon-merge-test-');
    this.mainRepoPath = await mkdtemp(baseDir);
    this.shadowRepoPath = await mkdtemp(baseDir + 'shadow-');

    // Optimization: Copy from pre-warmed template instead of running git init/config
    if (!MergeTestContext.templatePath) {
      throw new Error(
        'Template not initialized. Call MergeTestContext.prepareTemplate() in beforeAll.',
      );
    }

    // Copy template to main repo
    await cp(MergeTestContext.templatePath, this.mainRepoPath, { recursive: true });

    this.git = new GitHelper(this.mainRepoPath);

    // The shadow repo is usually a clone or a worktree sharing the object store.
    // Optimization: Use local clone with shared objects to speed up setup
    // Retry clone
    let cloneRetries = 0;
    while (cloneRetries < 5) {
      try {
        execFileSync(
          'git',
          ['clone', '--local', '--shared', this.mainRepoPath, this.shadowRepoPath],
          {
            stdio: 'ignore',
          },
        );
        break;
      } catch (e) {
        cloneRetries++;
        if (cloneRetries === 5) throw new Error(`Failed to clone shadow repo: ${e}`);
        await new Promise((r) => setTimeout(r, 100));
        // Try to clean up partial clone
        try {
          await rm(this.shadowRepoPath, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }

    this.shadowGit = new GitHelper(this.shadowRepoPath);
    this.shadowGit.run('config user.email "ai@example.com"');
    this.shadowGit.run('config user.name "AI Assistant"');
  }

  async teardown() {
    const rmOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };
    // Small delay before teardown to allow processes to exit
    await new Promise((r) => setTimeout(r, 100));
    // Optimization: Parallel teardown
    try {
      await Promise.all([rm(this.mainRepoPath, rmOptions), rm(this.shadowRepoPath, rmOptions)]);
    } catch (e) {
      // Ignore cleanup errors on Windows to prevent failing the test suite just because of cleanup
      if (process.platform !== 'win32') throw e;
      logger.warn(`Cleanup failed (ignored on Windows): ${e}`);
    }
  }

  async writeFile(repo: 'main' | 'shadow', filePath: string, content: string | Buffer) {
    const fullPath = join(repo === 'main' ? this.mainRepoPath : this.shadowRepoPath, filePath);
    await mkdir(join(fullPath, '..'), { recursive: true });

    // Retry loop for Windows EPERM/EBUSY issues
    let attempts = 0;
    while (attempts < 5) {
      try {
        await writeFile(fullPath, content);
        return;
      } catch (error: unknown) {
        if (attempts === 4) throw error;
        const code = getErrorCode(error);
        if (code === 'EPERM' || code === 'EBUSY') {
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempts)));
          attempts++;
        } else {
          throw error;
        }
      }
    }
  }

  async readFile(repo: 'main' | 'shadow', filePath: string): Promise<string> {
    const fullPath = join(repo === 'main' ? this.mainRepoPath : this.shadowRepoPath, filePath);
    return readFile(fullPath, 'utf-8');
  }

  createEngine(
    initialRef: string,
    latestRef: string,
    overrides: Partial<ConstructorParameters<typeof ShadowMergeEngine>[0]> = {},
  ): ShadowMergeEngine {
    return new ShadowMergeEngine(
      {
        mainRepoPath: this.mainRepoPath,
        shadowWorktreePath: this.shadowRepoPath,
        initialRef,
        latestRef,
        verbose: 'extended',
        applyBackOnDirty: '3way',
        ...overrides,
      },
      new CheckpointManager(),
    );
  }
}

describeMerge('ShadowMergeEngine Robustness', () => {
  let ctx: MergeTestContext;

  beforeAll(async () => {
    await MergeTestContext.prepareTemplate();
  });

  afterAll(async () => {
    await MergeTestContext.cleanupTemplate();
  });

  beforeEach(async () => {
    ctx = new MergeTestContext();
    await ctx.setup();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('Infrastructure Check: should setup repos correctly', async () => {
    expect(ctx.mainRepoPath).toBeDefined();
    expect(ctx.shadowRepoPath).toBeDefined();
    const status = ctx.git.statusEntries();
    expect(status).toHaveLength(0);
  });

  describe('Group 1: Staging State Transitions', () => {
    it(
      '1.1 Partial Staged: Modify -> Add -> Modify',
      async () => {
        // Setup
        const baseLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
        await ctx.writeFile('main', 'file.txt', baseLines);
        await ctx.git.add('file.txt');
        const initialRef = await ctx.git.commit('initial');

        // User Actions
        const stagedLines = baseLines.replace('line 1', 'user staged');
        await ctx.writeFile('main', 'file.txt', stagedLines);
        await ctx.git.add('file.txt'); // Staged
        const workingLines = stagedLines.replace('line 5', 'user working');
        await ctx.writeFile('main', 'file.txt', workingLines); // Unstaged

        // AI Actions (in Shadow)
        // Sync the shadow repo to initialRef.
        ctx.shadowGit.run(`fetch origin`);
        ctx.shadowGit.run(`reset --hard ${initialRef}`);
        const aiLines = baseLines.replace('line 10', 'ai changes');
        await ctx.writeFile('shadow', 'file.txt', aiLines);
        const latestRef = await ctx.shadowGit.commit('ai changes');

        // Execute Engine
        const engine = ctx.createEngine(initialRef, latestRef);
        try {
          await engine.apply();
        } catch (e: unknown) {
          const status = ctx.git.run('status');
          logger.error(`Git Status on failure:\n${status}`);
          const fileContent = await ctx.readFile('main', 'file.txt');
          logger.error(`File content on failure:\n${fileContent}`);
          throw e;
        }

        // Assertions
        // Assert working tree contains AI changes plus user working changes.
        const finalContent = await ctx.readFile('main', 'file.txt');
        const expectedWorking = baseLines
          .replace('line 1', 'user staged')
          .replace('line 5', 'user working')
          .replace('line 10', 'ai changes');
        expect(finalContent).toBe(expectedWorking);

        // Assert index contains ONLY user staged changes (Zero Index Access policy).
        // The AI changes are applied to the working tree, but the index is left untouched.
        const stagedContent = ctx.git.run('show :file.txt');
        expect(stagedContent).toBe(stagedLines);

        const headContent = ctx.git.run('show HEAD:file.txt');
        expect(headContent).toBe(baseLines);
      },
      { timeout: 30000 },
    );

    it('1.2 Full Staged: Modify -> Add -> Modify -> Add', async () => {
      // Setup
      const baseLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      // User Actions
      const stagedLines = baseLines.replace('line 1', 'user staged 1');
      await ctx.writeFile('main', 'file.txt', stagedLines);
      await ctx.git.add('file.txt');
      const finalStagedLines = stagedLines.replace('line 5', 'user staged 2');
      await ctx.writeFile('main', 'file.txt', finalStagedLines);
      await ctx.git.add('file.txt'); // Full Staged

      // AI Actions (in Shadow)
      ctx.shadowGit.run(`fetch origin`);
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 10', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      // Execute Engine
      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      // Assertions
      const finalContent = await ctx.readFile('main', 'file.txt');
      const expectedWorking = finalStagedLines.replace('line 10', 'ai changes');
      expect(finalContent).toBe(expectedWorking);

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toBe(finalStagedLines);

      const headContent = ctx.git.run('show HEAD:file.txt');
      expect(headContent).toBe(baseLines);
    });

    it('1.3 Staged then Reset (Mixed): Modify -> Add -> Reset', async () => {
      const baseLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = baseLines.replace('line 2', 'user unstaged');
      await ctx.writeFile('main', 'file.txt', userLines);
      await ctx.git.add('file.txt');
      await ctx.git.reset('mixed');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 9', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('user unstaged');
      expect(finalContent).toContain('ai changes');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: ' ', working: 'M', path: 'file.txt' });

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).not.toContain('ai changes');
    });

    it('1.4 Reset then Modify: Modify -> Add -> Reset -> Modify', async () => {
      const baseLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const firstChange = baseLines.replace('line 2', 'user staged');
      await ctx.writeFile('main', 'file.txt', firstChange);
      await ctx.git.add('file.txt');
      await ctx.git.reset('mixed');
      const workingChange = firstChange.replace('line 5', 'user working');
      await ctx.writeFile('main', 'file.txt', workingChange);

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 9', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('user staged');
      expect(finalContent).toContain('user working');
      expect(finalContent).toContain('ai changes');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: ' ', working: 'M', path: 'file.txt' });

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).not.toContain('ai changes');
    });

    it('1.5 Partial Add (Patch): simulate git add -p', async () => {
      const baseLines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = baseLines
        .replace('line 2', 'user staged')
        .replace('line 9', 'user working');
      await ctx.writeFile('main', 'file.txt', userLines);

      const stagedLines = baseLines.replace('line 2', 'user staged');
      ctx.git.updateIndex('file.txt', stagedLines);

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 11', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      const expectedWorking = baseLines
        .replace('line 2', 'user staged')
        .replace('line 9', 'user working')
        .replace('line 11', 'ai changes');
      expect(finalContent).toBe(expectedWorking);

      const stagedContent = ctx.git.run('show :file.txt');
      // Index should match user's staged content only
      expect(stagedContent).toBe(stagedLines);

      const status = ctx.git.statusEntry('file.txt');
      // Index is Modified vs HEAD (user staged)
      // Working is Modified vs Index (user working + ai changes)
      expect(status).toMatchObject({ index: 'M', working: 'M', path: 'file.txt' });

      const headContent = ctx.git.run('show HEAD:file.txt');
      expect(headContent).toBe(baseLines);
    });

    it('1.6 Commit during Think: user commits while AI runs', async () => {
      const baseLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userCommitLines = baseLines.replace('line 2', 'user commit');
      await ctx.writeFile('main', 'file.txt', userCommitLines);
      await ctx.git.commit('user commit');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 9', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('user commit');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toContain('user commit');
      expect(stagedContent).not.toContain('ai changes');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: ' ', working: 'M', path: 'file.txt' });
    });

    it('1.7 Commit then Modify: user commits then edits working tree', async () => {
      const baseLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userCommitLines = baseLines.replace('line 2', 'user commit');
      await ctx.writeFile('main', 'file.txt', userCommitLines);
      await ctx.git.commit('user commit');
      const userWorkingLines = userCommitLines.replace('line 5', 'user working');
      await ctx.writeFile('main', 'file.txt', userWorkingLines);

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 9', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('user commit');
      expect(finalContent).toContain('user working');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toContain('user commit');
      expect(stagedContent).not.toContain('ai changes');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: ' ', working: 'M', path: 'file.txt' });
    });

    it('1.8 Double Dirty: Staged + Unstaged + AI (MM State)', async () => {
      // Setup: Initial State
      const baseLines = 'line 1\nline 2\nline 3\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      await ctx.git.commit('initial');

      // User Action 1: Modify and Stage (A -> A+B)
      const stagedLines = baseLines + 'user staged\n';
      await ctx.writeFile('main', 'file.txt', stagedLines);
      await ctx.git.add('file.txt');

      // User Action 2: Modify but leave Unstaged (A+B -> A+B+C)
      // This creates the context "user unstaged" that the AI will see
      const workingLines = stagedLines + 'user unstaged\n';
      await ctx.writeFile('main', 'file.txt', workingLines);

      // Verify MM state
      const statusBefore = ctx.git.statusEntry('file.txt');
      expect(statusBefore).toMatchObject({ index: 'M', working: 'M', path: 'file.txt' });

      // AI Simulation:
      // AI sees the full working tree (A+B+C) as its Base.
      // We simulate this by creating a snapshot commit in shadow repo.
      ctx.shadowGit.run(`fetch origin`);
      // Create the "Snapshot" state in shadow (Base)
      await ctx.writeFile('shadow', 'file.txt', workingLines);
      await ctx.shadowGit.add('file.txt');
      const snapshotRef = await ctx.shadowGit.commit('snapshot of dirty state');

      // AI makes changes on top of Snapshot (A+B+C -> A+B+C+D)
      const aiLines = workingLines + 'ai changes\n';
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      // Execute Engine
      // initialRef = snapshotRef (The state AI started from)
      // latestRef = AI's new state
      const engine = ctx.createEngine(snapshotRef, latestRef);
      await engine.apply();

      // Assertions
      const finalContent = await ctx.readFile('main', 'file.txt');
      const expectedContent = baseLines + 'user staged\nuser unstaged\nai changes\n';
      expect(finalContent).toBe(expectedContent);

      // With Zero Index Access policy, the index should remain UNTOUCHED
      const indexContent = ctx.git.run('show :file.txt');
      expect(indexContent).toBe(stagedLines);

      const statusAfter = ctx.git.statusEntry('file.txt');
      // M (Index vs HEAD), M (Working vs Index)
      expect(statusAfter).toMatchObject({ index: 'M', working: 'M', path: 'file.txt' });
    });
  });

  describe('Group 2: Structural Changes', () => {
    it('2.1 Rename (Move): user renames file, AI modifies old path', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const oldPath = join(ctx.mainRepoPath, 'file.txt');
      const newPath = join(ctx.mainRepoPath, 'file-renamed.txt');
      await rename(oldPath, newPath);
      const movedContent = await ctx.readFile('main', 'file-renamed.txt');
      ctx.git.updateIndex('file-renamed.txt', movedContent);
      ctx.git.removeFromIndex('file.txt');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 6', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await expect(engine.apply()).rejects.toThrow(
        /Apply-back completed with conflicts in 1 file\(s\): file\.txt/,
      );

      const finalMoved = await ctx.readFile('main', 'file-renamed.txt');
      expect(finalMoved).not.toContain('ai changes');
      await expect(ctx.readFile('main', 'file.txt')).rejects.toThrow();
    });

    it('2.2 Delete (Tracked): user removes file from index', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const targetPath = join(ctx.mainRepoPath, 'file.txt');
      await rm(targetPath, { force: true });
      ctx.git.removeFromIndex('file.txt');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 5', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await expect(engine.apply()).rejects.toThrow(
        /Apply-back completed with conflicts in 1 file\(s\): file\.txt/,
      );

      await expect(ctx.readFile('main', 'file.txt')).rejects.toThrow();
    });

    it('2.3 Delete (Untracked): user deletes file without updating index', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const targetPath = join(ctx.mainRepoPath, 'file.txt');
      await rm(targetPath, { force: true });

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 5', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await expect(engine.apply()).rejects.toThrow(
        /Apply-back completed with conflicts in 1 file\(s\): file\.txt/,
      );

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toContain('line 1');
      await expect(ctx.readFile('main', 'file.txt')).rejects.toThrow();
    });

    it('2.4 Directory Move: user moves dir, AI modifies old path', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'dir/file.txt', baseLines);
      await ctx.git.add('dir/file.txt');
      const initialRef = await ctx.git.commit('initial');

      const oldDir = join(ctx.mainRepoPath, 'dir');
      const newDir = join(ctx.mainRepoPath, 'new_dir');
      await rename(oldDir, newDir);
      const movedContent = await ctx.readFile('main', 'new_dir/file.txt');
      ctx.git.updateIndex('new_dir/file.txt', movedContent);
      ctx.git.removeFromIndex('dir/file.txt');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 6', 'ai changes');
      await ctx.writeFile('shadow', 'dir/file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await expect(engine.apply()).rejects.toThrow(
        /Apply-back completed with conflicts in 1 file\(s\): dir\/file\.txt/,
      );

      const finalMoved = await ctx.readFile('main', 'new_dir/file.txt');
      expect(finalMoved).not.toContain('ai changes');
      await expect(ctx.readFile('main', 'dir/file.txt')).rejects.toThrow();
    });

    it('2.5 Chmod: user marks executable, AI modifies content', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const workingPath = join(ctx.mainRepoPath, 'file.txt');
      await chmod(workingPath, 0o755);
      const stagedContent = await ctx.readFile('main', 'file.txt');
      ctx.git.updateIndex('file.txt', stagedContent, '100755');
      const modeBefore = ctx.git.getIndexMode('file.txt');
      expect(modeBefore).toBe('100755');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 4', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('ai changes');

      const stagedAfter = ctx.git.run('show :file.txt');
      expect(stagedAfter).not.toContain('ai changes');
      const modeAfter = ctx.git.getIndexMode('file.txt');
      expect(modeAfter).toBe('100755');
    });
  });

  describe('Group 3: Untracked & Ignored Files', () => {
    it('3.1 Untracked to Tracked: user adds new file, AI adds same name', async () => {
      const initialRef = await ctx.git.getHead();

      const userContent = 'user content\n';
      await ctx.writeFile('main', 'new_file.txt', userContent);
      ctx.git.updateIndex('new_file.txt', userContent);

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiContent = 'ai content\n';
      await ctx.writeFile('shadow', 'new_file.txt', aiContent);
      await ctx.shadowGit.add('new_file.txt');
      const latestRef = await ctx.shadowGit.commit('ai adds file');

      const engine = ctx.createEngine(initialRef, latestRef);
      await expect(engine.apply()).rejects.toThrow(
        /Apply-back completed with conflicts|Patch application failed/,
      );

      const finalContent = await ctx.readFile('main', 'new_file.txt');
      expect(finalContent).toContain('user content');
      expect(finalContent).not.toContain('ai content');

      const stagedContent = ctx.git.run('show :new_file.txt');
      expect(stagedContent).toContain('user content');
    });

    it('3.2 Tracked to Untracked: user removes from index, AI modifies file', async () => {
      const baseLines = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      ctx.git.removeFromIndex('file.txt');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 4', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      // New architecture allows modifying untracked files via git apply
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('ai changes');
    });

    it('3.3 Gitignore Change: user ignores file, AI modifies it', async () => {
      const baseLines = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      await ctx.writeFile('main', '.gitignore', 'file.txt\n');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 4', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).not.toContain('ai changes');

      const ignoreContent = await ctx.readFile('main', '.gitignore');
      expect(ignoreContent).toContain('file.txt');
    });

    it('3.4 Force Add Ignored: user force-adds ignored file, AI modifies it', async () => {
      await ctx.writeFile('main', '.gitignore', 'ignored.txt\n');
      await ctx.git.add('.gitignore');
      const initialRef = await ctx.git.commit('ignore rule');

      const userContent = 'user ignored content\n';
      await ctx.writeFile('main', 'ignored.txt', userContent);
      ctx.git.updateIndex('ignored.txt', userContent);

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiContent = 'ai ignored content\n';
      await ctx.writeFile('shadow', 'ignored.txt', aiContent);
      ctx.shadowGit.run('add -f "ignored.txt"');
      const latestRef = await ctx.shadowGit.commit('ai modifies ignored');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'ignored.txt');
      expect(finalContent).toContain('user ignored content');
      expect(finalContent).toContain('ai ignored content');
      expect(finalContent).not.toContain('<<<<<<<');
      expect(finalContent).not.toContain('>>>>>>>');

      const stagedContent = ctx.git.run('show :ignored.txt');
      expect(stagedContent).toContain('user ignored content');
      expect(stagedContent).not.toContain('ai ignored content');
    });
  });

  describe('Group 4: Branching & Conflicts', () => {
    it('4.1 Checkout Branch: user switches branch before apply', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      ctx.git.run('checkout -b "feature"');
      const branchLines = baseLines.replace('line 3', 'branch change');
      await ctx.writeFile('main', 'file.txt', branchLines);
      await ctx.git.commit('branch change');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 7', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('branch change');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toContain('branch change');
      expect(stagedContent).not.toContain('ai changes');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: ' ', working: 'M', path: 'file.txt' });
    });

    it('4.2 Reset Hard: user discards changes before apply', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = baseLines.replace('line 4', 'user change');
      await ctx.writeFile('main', 'file.txt', userLines);
      await ctx.git.reset('hard');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 6', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).not.toContain('ai changes');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: ' ', working: 'M', path: 'file.txt' });
    });

    it('4.3 Pull/Rebase: base moves forward before apply', async () => {
      const baseLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const pulledLines = baseLines.replace('line 2', 'remote change');
      await ctx.writeFile('main', 'file.txt', pulledLines);
      await ctx.git.commit('remote update');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 9', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('remote change');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toContain('remote change');
      expect(stagedContent).not.toContain('ai changes');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: ' ', working: 'M', path: 'file.txt' });
    });

    it('4.4 Stash: user stashes changes before apply', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = baseLines.replace('line 2', 'user stash');
      await ctx.writeFile('main', 'file.txt', userLines);
      ctx.git.run('stash push -m "user stash"');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 6', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).not.toContain('ai changes');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: ' ', working: 'M', path: 'file.txt' });
    });
  });

  describe('Group 5: Extreme Combinations', () => {
    it('5.1 Modify -> Add -> Delete -> Reset: final state wins', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = baseLines.replace('line 2', 'user change');
      await ctx.writeFile('main', 'file.txt', userLines);
      await ctx.git.add('file.txt');
      const targetPath = join(ctx.mainRepoPath, 'file.txt');
      await rm(targetPath, { force: true });
      ctx.git.removeFromIndex('file.txt');
      await ctx.git.reset('hard');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 6', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).not.toContain('ai changes');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: ' ', working: 'M', path: 'file.txt' });
    });

    it('5.2 Modify -> Add -> Commit -> Reset --soft: staged merge', async () => {
      const baseLines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = baseLines.replace('line 3', 'user change');
      await ctx.writeFile('main', 'file.txt', userLines);
      await ctx.git.add('file.txt');
      await ctx.git.commit('user commit');
      await ctx.git.reset('soft', 'HEAD~1');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 7', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('user change');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toContain('user change');
      expect(stagedContent).not.toContain('ai changes');
    });

    it('5.3 New -> Modify -> Add -> Delete: strict failure on deleted file', async () => {
      const initialRef = await ctx.git.getHead();

      const userContent = 'user new file\n';
      await ctx.writeFile('main', 'temp.txt', userContent);
      const userUpdated = `${userContent}user edit\n`;
      await ctx.writeFile('main', 'temp.txt', userUpdated);
      ctx.git.updateIndex('temp.txt', userUpdated);
      const targetPath = join(ctx.mainRepoPath, 'temp.txt');
      await rm(targetPath, { force: true });

      const preStatus = ctx.git.statusEntryForPath('temp.txt');
      expect(preStatus).toMatchObject({ index: 'A', working: 'D', path: 'temp.txt' });

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiContent = 'ai new file\n';
      await ctx.writeFile('shadow', 'temp.txt', aiContent);
      await ctx.shadowGit.add('temp.txt');
      const latestRef = await ctx.shadowGit.commit('ai adds file');

      const engine = ctx.createEngine(initialRef, latestRef);
      await expect(engine.apply()).rejects.toThrow(
        /Apply-back completed with conflicts|Patch application failed/,
      );

      // Rollback to T1 might preserve file depending on git behavior for AD state
      try {
        const content = await ctx.readFile('main', 'temp.txt');
        expect(content).toBe(userUpdated);
      } catch (e: unknown) {
        if (getErrorCode(e) !== 'ENOENT') throw e;
      }

      const finalStatus = ctx.git.statusEntryForPath('temp.txt');
      expect(finalStatus).toMatchObject({ index: 'A', working: 'D', path: 'temp.txt' });
    });

    it('5.4 Index Lock Contention: apply fails gracefully', async () => {
      const baseLines = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = baseLines.replace('line 2', 'user staged');
      await ctx.writeFile('main', 'file.txt', userLines);
      await ctx.git.add('file.txt');

      const lockPath = join(ctx.mainRepoPath, '.git', 'index.lock');
      await writeFile(lockPath, 'locked');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = baseLines.replace('line 4', 'ai changes');
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await expect(engine.apply()).rejects.toThrow(/index\.lock/i);
    });
  });

  describe('Group 6: Additional Scenarios', () => {
    it('6.1 Multi-file: AI modifies 3 files, user stages 1', async () => {
      const baseLines = 'line 1\nline 2\nline 3\n';
      await ctx.writeFile('main', 'a.txt', baseLines);
      await ctx.writeFile('main', 'b.txt', baseLines);
      await ctx.writeFile('main', 'c.txt', baseLines);
      await ctx.git.add('.');
      const initialRef = await ctx.git.commit('initial');

      const userStaged = baseLines.replace('line 1', 'user staged');
      await ctx.writeFile('main', 'a.txt', userStaged);
      await ctx.git.add('a.txt');

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiA = baseLines.replace('line 3', 'ai changes');
      const aiB = baseLines.replace('line 1', 'ai changes');
      const aiC = baseLines.replace('line 2', 'ai changes');
      await ctx.writeFile('shadow', 'a.txt', aiA);
      await ctx.writeFile('shadow', 'b.txt', aiB);
      await ctx.writeFile('shadow', 'c.txt', aiC);
      await ctx.shadowGit.add('.');
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const aContent = await ctx.readFile('main', 'a.txt');
      expect(aContent).toContain('user staged');
      expect(aContent).toContain('ai changes');
      const bContent = await ctx.readFile('main', 'b.txt');
      expect(bContent).toContain('ai changes');
      const cContent = await ctx.readFile('main', 'c.txt');
      expect(cContent).toContain('ai changes');

      const aIndex = ctx.git.run('show :a.txt');
      const expectedAIndex = baseLines.replace('line 1', 'user staged');
      expect(aIndex).toBe(expectedAIndex);
      const bIndex = ctx.git.run('show :b.txt');
      expect(bIndex).toBe(baseLines);
      const cIndex = ctx.git.run('show :c.txt');
      expect(cIndex).toBe(baseLines);

      const aStatus = ctx.git.statusEntry('a.txt');
      expect(aStatus).toMatchObject({ index: 'M', working: 'M', path: 'a.txt' });
      const bStatus = ctx.git.statusEntry('b.txt');
      expect(bStatus).toMatchObject({ index: ' ', working: 'M', path: 'b.txt' });
      const cStatus = ctx.git.statusEntry('c.txt');
      expect(cStatus).toMatchObject({ index: ' ', working: 'M', path: 'c.txt' });
    });

    it('6.2 Real 3-way conflict: both modify same line', async () => {
      const baseLines = 'line 1\nline 2\nline 3\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = 'line 1\nuser change\nline 3\n';
      await ctx.writeFile('main', 'file.txt', userLines);

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = 'line 1\nai change\nline 3\n';
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await expect(engine.apply()).rejects.toThrow(
        /Apply-back completed with conflicts in 1 file\(s\): file\.txt/,
      );

      // Zero Trust architecture should preserve user changes and rollback
      const content = await ctx.readFile('main', 'file.txt');
      expect(content).toBe('line 1\nuser change\nline 3\n');
      expect(content).not.toContain('<<<<<<<');
      expect(content).not.toContain('>>>>>>>');
    });

    it('6.3 Large file: exceeds maxFileBytes limit', async () => {
      const initialRef = await ctx.git.getHead();

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const largeContent = Buffer.alloc(2048, 'x');
      await ctx.writeFile('shadow', 'large.txt', largeContent);
      await ctx.shadowGit.add('large.txt');
      const latestRef = await ctx.shadowGit.commit('ai large file');

      const engine = ctx.createEngine(initialRef, latestRef, { maxFileBytes: 1024 });
      await engine.apply();

      await expect(ctx.readFile('main', 'large.txt')).rejects.toThrow();
      const status = ctx.git.statusEntry('large.txt');
      expect(status).toBeNull();
    });

    it('6.4 CRLF handling: preserve user line endings', async () => {
      const baseLines = 'line 1\r\nline 2\r\nline 3\r\n';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = 'user change\r\nline 2\r\nline 3\r\n';
      await ctx.writeFile('main', 'file.txt', userLines);

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = 'line 1\nline 2\nai change\n';
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('user change');
      expect(finalContent).toContain('ai change');
      expect(finalContent).toContain('\r\n');
      const withoutCrlf = finalContent.replace(/\r\n/g, '');
      expect(withoutCrlf).not.toContain('\n');
    });

    it('6.5 No trailing newline: preserve EOF without newline', async () => {
      const baseLines = 'line 1\nline 2\nline 3';
      await ctx.writeFile('main', 'file.txt', baseLines);
      await ctx.git.add('file.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = 'user line 1\nline 2\nline 3';
      await ctx.writeFile('main', 'file.txt', userLines);

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = 'line 1\nline 2\nai line 3';
      await ctx.writeFile('shadow', 'file.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toBe('user line 1\nline 2\nai line 3');
      expect(finalContent.endsWith('\n')).toBe(false);
    });

    it('6.6 Binary detection: null byte signature', async () => {
      const initialRef = await ctx.git.getHead();

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
      await ctx.writeFile('shadow', 'binary.dat', binaryContent);
      await ctx.shadowGit.add('binary.dat');
      const latestRef = await ctx.shadowGit.commit('ai binary');

      const engine = ctx.createEngine(initialRef, latestRef);
      // Binary supported!
      await engine.apply();

      const content = await ctx.readFile('main', 'binary.dat');
      expect(content).toBe(binaryContent.toString());
      const status = ctx.git.statusEntry('binary.dat');
      expect(status).not.toBeNull();
    }, 20000);

    it('6.7 Binary detection: extension-based', async () => {
      const initialRef = await ctx.git.getHead();

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      await ctx.writeFile('shadow', 'image.png', 'not really png');
      await ctx.shadowGit.add('image.png');
      const latestRef = await ctx.shadowGit.commit('ai png');

      const engine = ctx.createEngine(initialRef, latestRef);
      // Binary supported!
      await engine.apply();

      const content = await ctx.readFile('main', 'image.png');
      expect(content).toBe('not really png');
      const status = ctx.git.statusEntry('image.png');
      expect(status).not.toBeNull();
    }, 20000);

    it('6.8 shouldAllowPath: custom filter rejects file', async () => {
      const initialRef = await ctx.git.getHead();

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      await ctx.writeFile('shadow', 'allowed.txt', 'ai allowed\n');
      await ctx.writeFile('shadow', 'secret.txt', 'ai secret\n');
      await ctx.shadowGit.add('.');
      const latestRef = await ctx.shadowGit.commit('ai adds files');

      const engine = ctx.createEngine(initialRef, latestRef, {
        shouldAllowPath: async (path) => {
          if (path === 'secret.txt') return { allowed: false, reason: 'secret' };
          return { allowed: true };
        },
      });
      await engine.apply();

      const allowed = await ctx.readFile('main', 'allowed.txt');
      expect(allowed).toContain('ai allowed');
      await expect(ctx.readFile('main', 'secret.txt')).rejects.toThrow();
    });

    it('6.9 Conflict Resolution: should generate .rej files on conflict', async () => {
      const baseLines = 'line 1\nline 2\nline 3\n';
      await ctx.writeFile('main', 'conflict.txt', baseLines);
      await ctx.git.add('conflict.txt');
      const initialRef = await ctx.git.commit('initial');

      const userLines = 'line 1\nuser change\nline 3\n';
      await ctx.writeFile('main', 'conflict.txt', userLines);

      ctx.shadowGit.run(`fetch origin`);
      ctx.shadowGit.run(`reset --hard ${initialRef}`);
      const aiLines = 'line 1\nai change\nline 3\n';
      await ctx.writeFile('shadow', 'conflict.txt', aiLines);
      const latestRef = await ctx.shadowGit.commit('ai changes');

      const engine = ctx.createEngine(initialRef, latestRef);
      await expect(engine.apply()).rejects.toThrow(/\.rej/);

      const rejContent = await ctx.readFile(
        'main',
        '.salmonloop/runtime/rejections/conflict.txt.rej',
      );
      expect(rejContent).toBe(aiLines);
    });
  });

  describe('Group 7: Advanced EOL Handling', () => {
    it('7.1 Mixed EOL (CRLF dominant) -> Expect CRLF output', async () => {
      const filename = 'mixed_crlf.txt';
      // 3 CRLF, 1 LF -> CRLF dominant
      const content = 'line1\r\nline2\r\nline3\nline4\r\n';
      await ctx.writeFile('main', filename, content);
      await ctx.git.add(filename);
      await ctx.git.commit('add mixed crlf file');
      const baseRef = await ctx.git.getHead();

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${baseRef}`);

      // AI adds a line with LF
      const shadowContent = 'line1\r\nline2\r\nline3\nline4\r\nline5\n';
      await ctx.writeFile('shadow', filename, shadowContent);
      const shadowRef = await ctx.shadowGit.commit('ai update');

      const engine = ctx.createEngine(baseRef, shadowRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', filename);
      // Should normalize the new line to CRLF
      expect(finalContent).toContain('line5\r\n');
    });

    it('7.2 Mixed EOL (LF dominant) -> Expect LF output', async () => {
      const filename = 'mixed_lf.txt';
      // 3 LF, 1 CRLF -> LF dominant
      const content = 'line1\nline2\nline3\r\nline4\n';
      await ctx.writeFile('main', filename, content);
      await ctx.git.add(filename);
      await ctx.git.commit('add mixed lf file');
      const baseRef = await ctx.git.getHead();

      ctx.shadowGit.run('fetch origin');
      ctx.shadowGit.run(`reset --hard ${baseRef}`);

      // AI adds a line with CRLF
      const shadowContent = 'line1\nline2\nline3\r\nline4\nline5\r\n';
      await ctx.writeFile('shadow', filename, shadowContent);
      const shadowRef = await ctx.shadowGit.commit('ai update');

      const engine = ctx.createEngine(baseRef, shadowRef);
      await engine.apply();

      const finalContent = await ctx.readFile('main', filename);
      // Should normalize the new line to LF
      expect(finalContent).toContain('line5\n');
      expect(finalContent).not.toContain('line5\r\n');
    });
  });
});
