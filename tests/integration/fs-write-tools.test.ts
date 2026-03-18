import { afterEach, describe, expect, it } from 'bun:test';

import { StubLLM } from '../../src/core/llm/openai.js';
import { RuntimeEnvironment } from '../../src/core/strata/runtime/environment.js';
import {
  executeFsCreateDirectory,
  executeFsDeleteFile,
  executeFsWriteFile,
} from '../../src/core/tools/builtin/fs.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('fs write tools (integration)', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('writes files in shadow worktree without modifying base workspace', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'foo.txt', content: 'old\n' }],
      createInitialCommit: true,
    });

    const env = new RuntimeEnvironment(
      {
        instruction: 'write file',
        repoPath: repo.path,
        llm: new StubLLM(),
        strategy: 'worktree',
        verify: undefined,
      },
      () => {},
    );

    await env.setup();
    try {
      const worktreePath = env.workspace!.workPath;

      const res = await executeFsWriteFile({ file: 'foo.txt', content: 'new\n' }, {
        repoRoot: worktreePath,
        worktreeRoot: worktreePath,
        persistenceRoot: repo.path,
        attemptId: 1,
        dryRun: false,
      } as any);

      expect(res.ok).toBe(true);
      expect(res.bytesWritten).toBeGreaterThan(0);

      const base = await helper.readFile(repo.path, 'foo.txt');
      const baseStr = typeof base === 'string' ? base : base.toString('utf-8');
      expect(baseStr.replace(/\r\n/g, '\n')).toBe('old\n');

      const shadow = await helper.readFile(worktreePath, 'foo.txt');
      const shadowStr = typeof shadow === 'string' ? shadow : shadow.toString('utf-8');
      expect(shadowStr.replace(/\r\n/g, '\n')).toBe('new\n');
    } finally {
      await env.teardown();
    }
  });

  it('creates directories and deletes files in shadow worktree', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'bar.txt', content: 'keep\n' }],
      createInitialCommit: true,
    });

    const env = new RuntimeEnvironment(
      {
        instruction: 'fs ops',
        repoPath: repo.path,
        llm: new StubLLM(),
        strategy: 'worktree',
        verify: undefined,
      },
      () => {},
    );

    await env.setup();
    try {
      const worktreePath = env.workspace!.workPath;
      const toolCtx = {
        repoRoot: worktreePath,
        worktreeRoot: worktreePath,
        persistenceRoot: repo.path,
        attemptId: 1,
        dryRun: false,
      } as any;

      const mkdirRes = await executeFsCreateDirectory(
        { path: 'nested/a', recursive: true },
        toolCtx,
      );
      expect(mkdirRes.ok).toBe(true);

      await executeFsWriteFile({ file: 'nested/a/delete-me.txt', content: 'tmp\n' }, toolCtx);

      const deleteRes = await executeFsDeleteFile(
        { file: 'nested/a/delete-me.txt', missingOk: false },
        toolCtx,
      );
      expect(deleteRes.ok).toBe(true);
      expect(deleteRes.deleted).toBe(true);

      await expect(helper.readFile(worktreePath, 'nested/a/delete-me.txt')).rejects.toThrow();
      const base = await helper.readFile(repo.path, 'bar.txt');
      const baseStr = typeof base === 'string' ? base : base.toString('utf-8');
      expect(baseStr.replace(/\r\n/g, '\n')).toBe('keep\n');
    } finally {
      await env.teardown();
    }
  });

  it('enforces path safety and reserved prefixes', async () => {
    const repo = await helper.createGitRepo({ createInitialCommit: true });

    const toolCtx = {
      repoRoot: repo.path,
      worktreeRoot: repo.path,
      persistenceRoot: repo.path,
      attemptId: 1,
      dryRun: false,
    } as any;

    await expect(
      executeFsWriteFile({ file: '../evil.txt', content: 'no\n' }, toolCtx),
    ).rejects.toThrow('outside of repository');

    await expect(
      executeFsCreateDirectory({ path: '.git/hack', recursive: true }, toolCtx),
    ).rejects.toThrow('Reserved path prefix');

    await expect(
      executeFsWriteFile({ file: '.salmonloop/hack.txt', content: 'no\n' }, toolCtx),
    ).rejects.toThrow('Reserved path prefix');

    await expect(
      executeFsDeleteFile({ file: 'missing.txt', missingOk: false }, toolCtx),
    ).rejects.toThrow('Path not found');
  });
});
