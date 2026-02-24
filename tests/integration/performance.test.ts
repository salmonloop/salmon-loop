import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import { LLM } from '../../src/core/llm/index.js';
import { runSalmonLoop } from '../../src/core/runtime/loop.js';

// CRITICAL: NO GLOBAL MOCKS. This is a performance test on the real system.

const mockLlm = {
  createPlan: vi.fn(),
  createPatch: vi.fn(),
  chat: vi.fn().mockResolvedValue({ role: 'assistant', content: 'Ready' }),
} as unknown as LLM;

describe('Performance Integration Tests', () => {
  let repoPath: string;

  beforeEach(async () => {
    // Create real temp directory
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'salmon-loop-perf-'));

    // Initialize a real git repo
    await fs.mkdir(path.join(repoPath, '.git'), { recursive: true });
    // We need a minimal git config for git commands to work
    const git = new GitAdapter(repoPath);
    await git.exec(['init', '--initial-branch=main']);
    await git.exec(['config', 'user.email', 'test@test.com']);
    await git.exec(['config', 'user.name', 'Test']);

    // Simulate a large repository with 100 files (reduced from 1000 to keep test reasonable on real FS)
    // 1000 real file writes + git adds might be too slow for a quick test, but let's try 100 first.
    // The original test mocked everything so 1000 was instant.
    const filePromises = [];
    for (let i = 0; i < 100; i++) {
      filePromises.push(
        fs.writeFile(path.join(repoPath, `file${i}.ts`), `console.log("file ${i}");\n`),
      );
    }
    await Promise.all(filePromises);

    // Commit them so they are tracked
    await git.exec(['add', '.']);
    await git.exec(['commit', '-m', 'Initial commit']);

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // vi.restoreAllMocks(); // Handled by setup.ts
    if (repoPath) {
      await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('should handle a repository execution without significant overhead', async () => {
    // We still mock the LLM because we are testing the loop engine performance, not OpenAI.
    (mockLlm.createPlan as any).mockResolvedValue({
      goal: 'Fix',
      files: ['file0.ts'],
      changes: ['Fix log'],
      verify: 'echo "passed"',
    });

    // Provide a valid patch for file0.ts
    (mockLlm.createPatch as any).mockResolvedValue(
      'diff --git a/file0.ts b/file0.ts\n' +
        '--- a/file0.ts\n' +
        '+++ b/file0.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("file 0");\n' +
        '+console.log("fixed");',
    );

    const start = Date.now();
    const result = await runSalmonLoop({
      instruction: 'Fix file0',
      verify: 'echo "passed"',
      repoPath: repoPath,
      llm: mockLlm,
      // Use direct strategy to avoid worktree overhead for this perf test
      strategy: 'direct',
    });
    const end = Date.now();

    expect(result.success).toBe(true);
    // Real FS operations take time, so we relax the timeout check or just check success.
    // The previous check was < 5000ms for 1000 files with mocks.
    // Real world: 100 files should be fast enough.
    expect(end - start).toBeLessThan(10000);

    // Verify side effect
    const content = await fs.readFile(path.join(repoPath, 'file0.ts'), 'utf-8');
    expect(content).toContain('console.log("fixed")');
  });
});
