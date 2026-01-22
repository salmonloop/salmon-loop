import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir, rename, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ShadowMergeEngine } from '../../src/core/merge/shadow-merge.js';

class GitHelper {
  constructor(public cwd: string) {}

  run(command: string): string {
    try {
      return execSync(`git ${command}`, { cwd: this.cwd, stdio: 'pipe' }).toString();
    } catch (error: any) {
      throw new Error(`Git command failed: git ${command}\n${error.stderr?.toString() || error.message}`);
    }
  }

  runWithInput(command: string, input: string | Buffer): string {
    try {
      return execSync(`git ${command}`, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        input,
      }).toString();
    } catch (error: any) {
      throw new Error(`Git command failed: git ${command}\n${error.stderr?.toString() || error.message}`);
    }
  }

  async init() {
    this.run('init');
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

  private parseStatus(output: string): Array<{ path: string; index: string; working: string; raw: string }> {
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

  statusEntryForPath(path: string): { path: string; index: string; working: string; raw: string } | null {
    const entries = this.parseStatus(this.run(`status --porcelain -- "${path}"`));
    return entries[0] ?? null;
  }
}

class MergeTestContext {
  public mainRepoPath!: string;
  public shadowRepoPath!: string;
  public git!: GitHelper;
  public shadowGit!: GitHelper;

  async setup() {
    const baseDir = join(tmpdir(), 'salmon-merge-test-');
    this.mainRepoPath = await mkdtemp(baseDir);
    this.shadowRepoPath = await mkdtemp(baseDir + 'shadow-');
    
    this.git = new GitHelper(this.mainRepoPath);
    await this.git.init();

    // The shadow repo is usually a clone or a worktree sharing the object store.
    // For test simplicity, clone the main repo into the shadow repo.
    execSync(`git clone "${this.mainRepoPath}" "${this.shadowRepoPath}"`);
    this.shadowGit = new GitHelper(this.shadowRepoPath);
    this.shadowGit.run('config user.email "ai@example.com"');
    this.shadowGit.run('config user.name "AI Assistant"');
  }

  async teardown() {
    await rm(this.mainRepoPath, { recursive: true, force: true });
    await rm(this.shadowRepoPath, { recursive: true, force: true });
  }

  async writeFile(repo: 'main' | 'shadow', filePath: string, content: string) {
    const fullPath = join(repo === 'main' ? this.mainRepoPath : this.shadowRepoPath, filePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content);
  }

  async readFile(repo: 'main' | 'shadow', filePath: string): Promise<string> {
    const fullPath = join(repo === 'main' ? this.mainRepoPath : this.shadowRepoPath, filePath);
    return readFile(fullPath, 'utf-8');
  }

  createEngine(initialRef: string, latestRef: string): ShadowMergeEngine {
    return new ShadowMergeEngine({
      mainRepoPath: this.mainRepoPath,
      shadowWorktreePath: this.shadowRepoPath,
      initialRef,
      latestRef,
      verbose: 'extended'
    });
  }
}

describe('ShadowMergeEngine Robustness', () => {
  let ctx: MergeTestContext;

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
    it('1.1 Partial Staged: Modify -> Add -> Modify', async () => {
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
      } catch (e: any) {
        const status = ctx.git.run('status');
        console.log('Git Status on failure:\n', status);
        const fileContent = await ctx.readFile('main', 'file.txt');
        console.log('File content on failure:\n', fileContent);
        throw e;
      }

      // Assertions
      // Assert working tree contains AI changes plus user working changes.
      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('user working');
      expect(finalContent).toContain('ai changes');
      
      // Assert index contains AI changes plus user staged changes.
      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toContain('user staged');
      expect(stagedContent).toContain('ai changes');
    });

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
      expect(finalContent).toContain('user staged 1');
      expect(finalContent).toContain('user staged 2');
      expect(finalContent).toContain('ai changes');
      
      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toContain('user staged 1');
      expect(stagedContent).toContain('user staged 2');
      expect(stagedContent).toContain('ai changes');
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
      expect(finalContent).toContain('user staged');
      expect(finalContent).toContain('user working');
      expect(finalContent).toContain('ai changes');

      const stagedContent = ctx.git.run('show :file.txt');
      expect(stagedContent).toContain('user staged');
      expect(stagedContent).toContain('ai changes');
      expect(stagedContent).not.toContain('user working');

      const status = ctx.git.statusEntry('file.txt');
      expect(status).toMatchObject({ index: 'M', working: 'M', path: 'file.txt' });
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
      await expect(engine.apply()).rejects.toThrow(/file\.txt/);

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
      await expect(engine.apply()).rejects.toThrow(/file\.txt/);

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
      await expect(engine.apply()).rejects.toThrow(/file\.txt/);

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
      await expect(engine.apply()).rejects.toThrow(/dir\/file\.txt/);

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
      expect(stagedAfter).toContain('ai changes');
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
      await expect(engine.apply()).rejects.toThrow(/new_file\.txt/);

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
      await expect(engine.apply()).rejects.toThrow(/file\.txt/);

      const finalContent = await ctx.readFile('main', 'file.txt');
      expect(finalContent).toContain('line 1');
      expect(finalContent).not.toContain('ai changes');
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
      expect(stagedContent).toContain('ai changes');
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
      await expect(engine.apply()).rejects.toThrow(/temp\.txt/);

      await expect(ctx.readFile('main', 'temp.txt')).rejects.toThrow();

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
});
