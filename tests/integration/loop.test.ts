import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { AstParser } from '../../src/core/ast/parser.js';
import { LLM } from '../../src/core/llm/index.js';
import { runSalmonLoop } from '../../src/core/runtime/loop.js';
import { executeArtifactRead } from '../../src/core/tools/builtin/artifact.js';
import { buildBunCommand } from '../helpers/bun.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

// Mock the LLM
const mockLlm = {
  createPlan: mock(),
  createPatch: mock(),
  chat: mock().mockResolvedValue({ role: 'assistant', content: 'Ready' }),
} as unknown as any;

describe('SalmonLoop Integration Tests', () => {
  const helper = new RealFsTestHelper();
  const bunCommand = (args: string) => buildBunCommand(args);
  let repoPath: string;

  beforeEach(async () => {
    // Create real Git repository with explicit identity for physical commits
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/index.ts', content: 'console.log("hello");\n' }],
      gitConfig: {
        'user.name': 'Salmon Test',
        'user.email': 'test@salmon.ai',
        'core.safecrlf': 'false',
      },
    });
    repoPath = repo.path;

    spyOn(AstParser, 'parse').mockResolvedValue({
      rootNode: {
        hasError: false,
        children: [],
        type: 'program',
        text: 'console.log("hello");',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 20 },
      } as any,
      delete: mock(),
    } as any);
    spyOn(AstParser, 'identifyDefinitions').mockResolvedValue([]);
    spyOn(AstParser, 'identifyReferences').mockResolvedValue([]);

    // Ensure LLM chat has a default response for every test
    mockLlm.chat.mockResolvedValue({ role: 'assistant', content: 'Ready' });
  });

  afterEach(async () => {
    await helper.cleanup();
    mock.restore();
  });

  it('should complete a successful loop', async () => {
    mockLlm.createPlan.mockResolvedValue({
      goal: 'Fix the log message',
      files: ['src/index.ts'],
      changes: ['Change hello to world'],
      verify: bunCommand('src/index.ts'),
    });

    mockLlm.createPatch.mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
        '--- a/src/index.ts\n' +
        '+++ b/src/index.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("hello");\n' +
        '+console.log("world");',
    );

    const result = await runSalmonLoop({
      instruction: 'Fix the log message',
      verify: bunCommand('src/index.ts'),
      repoPath: repoPath,
      file: 'src/index.ts',
      llm: mockLlm as unknown as LLM,
    });

    if (result.attempts === 0) {
      console.error('Test failed with attempts 0. Reason:', result.reason);
    }

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);

    // Verify file content was actually changed on disk
    const content = await helper.readFile(repoPath, 'src/index.ts');
    expect(content).toContain('console.log("world")');
  });

  it('should retry when verification fails', async () => {
    await helper.writeFile(repoPath, 'fail.ts', "console.error('fail'); process.exit(1);");
    await helper.git(repoPath, ['add', 'fail.ts']);
    await helper.git(repoPath, ['commit', '-m', 'add fail script']);
    const failingVerify = bunCommand('fail.ts');
    mockLlm.createPlan.mockResolvedValue({
      goal: 'Fix the log message',
      files: ['src/index.ts'],
      changes: ['Change hello to world'],
      verify: failingVerify,
    });

    mockLlm.createPatch.mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
        '--- a/src/index.ts\n' +
        '+++ b/src/index.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("hello");\n' +
        '+console.log("world");',
    );

    const result = await runSalmonLoop({
      instruction: 'Fix the log message',
      verify: failingVerify,
      repoPath: repoPath,
      file: 'src/index.ts',
      llm: mockLlm as unknown as LLM,
    });

    if (result.attempts === 0 && !result.success) {
      console.error('Failure Logs:', JSON.stringify(result.logs, null, 2));
      throw new Error(`Physical Pre-flight failed: ${result.reason}`);
    }

    expect(result.success).toBe(false);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
  });

  it('stores verify output as an artifact when verification fails', async () => {
    await helper.writeFile(repoPath, 'fail.ts', "console.error('fail'); process.exit(1);");
    await helper.git(repoPath, ['add', 'fail.ts']);
    await helper.git(repoPath, ['commit', '-m', 'add fail script']);
    const failingVerify = bunCommand('fail.ts');
    mockLlm.createPlan.mockResolvedValue({
      goal: 'Log failure',
      files: ['src/index.ts'],
      changes: ['Change log content'],
      verify: failingVerify,
    });

    mockLlm.createPatch.mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
        '--- a/src/index.ts\n' +
        '+++ b/src/index.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("hello");\n' +
        '+console.log("world");',
    );

    const result = await runSalmonLoop({
      instruction: 'Log failure',
      verify: failingVerify,
      repoPath: repoPath,
      file: 'src/index.ts',
      llm: mockLlm as unknown as LLM,
    });

    expect(result.success).toBe(false);
    expect(result.verifyArtifact).toBeDefined();

    const artifact = await executeArtifactRead(
      { handle: result.verifyArtifact!.handle },
      {} as any,
    );
    expect(artifact.content).toContain('fail');
  });

  it('should use worktree strategy when requested', async () => {
    mockLlm.createPlan.mockResolvedValue({
      goal: 'Fix the log message',
      files: ['src/index.ts'],
      changes: ['Change hello to world'],
      verify: bunCommand('src/index.ts'),
    });

    mockLlm.createPatch.mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
        '--- a/src/index.ts\n' +
        '+++ b/src/index.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("hello");\n' +
        '+console.log("world");',
    );

    const result = await runSalmonLoop({
      instruction: 'Fix the log message',
      verify: bunCommand('src/index.ts'),
      repoPath: repoPath,
      file: 'src/index.ts',
      llm: mockLlm as unknown as LLM,
      strategy: 'worktree',
    });

    if (result.attempts === 0 && !result.success) {
      console.error('Failure Logs:', JSON.stringify(result.logs, null, 2));
      throw new Error(`Physical Worktree Setup failed: ${result.reason}`);
    }

    expect(result.success).toBe(true);

    // Verify changes applied back to main repo
    const content = await helper.readFile(repoPath, 'src/index.ts');
    expect(content).toContain('console.log("world")');
  });

  it('runs PREPARE_DEPS before VERIFY in worktree mode', async () => {
    const prepareMarker = '.prepare-deps-ok';
    await helper.writeFile(
      repoPath,
      'prepare.ts',
      `import { writeFileSync } from 'fs'; writeFileSync('${prepareMarker}', 'ok');`,
    );
    await helper.writeFile(
      repoPath,
      'verify.ts',
      `import { existsSync } from 'fs'; process.exit(existsSync('${prepareMarker}') ? 0 : 1);`,
    );
    await helper.git(repoPath, ['add', 'prepare.ts', 'verify.ts']);
    await helper.git(repoPath, ['commit', '-m', 'add scripts']);

    const worktreePrepare = bunCommand('prepare.ts');
    const verifyPrepare = bunCommand('verify.ts');

    mockLlm.createPlan.mockResolvedValue({
      goal: 'Fix the log message',
      files: ['src/index.ts'],
      changes: ['Change hello to world'],
      verify: verifyPrepare,
    });

    mockLlm.createPatch.mockResolvedValue(
      'diff --git a/src/index.ts b/src/index.ts\n' +
        '--- a/src/index.ts\n' +
        '+++ b/src/index.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("hello");\n' +
        '+console.log("world");',
    );

    const phaseStarts: string[] = [];
    const result = await runSalmonLoop({
      instruction: 'Fix the log message',
      verify: verifyPrepare,
      repoPath: repoPath,
      file: 'src/index.ts',
      llm: mockLlm as unknown as LLM,
      strategy: 'worktree',
      worktreePrepare,
      onEvent: (event) => {
        if (event.type === 'phase.start') {
          phaseStarts.push(event.phase);
        }
      },
    });

    if (!result.success) {
      console.error('Test failed with reason:', result.reason);
      console.error('Failure Logs:', JSON.stringify(result.logs, null, 2));
    }
    expect(result.success).toBe(true);

    const prepareDepsIndex = phaseStarts.indexOf('PREPARE_DEPS');
    const verifyIndex = phaseStarts.indexOf('VERIFY');

    expect(prepareDepsIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(prepareDepsIndex).toBeLessThan(verifyIndex);
  });
});
