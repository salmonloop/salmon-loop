import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSalmonLoop } from '../../src/index.js';
import { FakeLLM } from '../../src/core/llm.js';
import { ExecutionPhase } from '../../src/core/types.js';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

describe('Deterministic Baseline Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'salmon-test-'));
    // Initialize git repo
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@example.com"', { cwd: tempDir });
    execSync('git config user.name "Test User"', { cwd: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should fix a compilation error', async () => {
    const filePath = join(tempDir, 'index.ts');
    await writeFile(filePath, 'const x: number = "not a number";\n');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });

    const fakeLLM = new FakeLLM(
      [{ goal: 'fix type', files: ['index.ts'], changes: ['fix type'], verify: 'tsc' }],
      [`diff --git a/index.ts b/index.ts
--- a/index.ts
+++ b/index.ts
@@ -1 +1 @@
-const x: number = "not a number";
+const x: number = 123;
`]
    );

    const result = await runSalmonLoop({
      instruction: 'fix compilation error',
      verify: 'echo "success"', // Mock verify command
      repoPath: tempDir,
      llm: fakeLLM,
      allowDirty: true
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('should fail-fast on diff limit exceeded', async () => {
    const filePath = join(tempDir, 'large.ts');
    await writeFile(filePath, 'line1\nline2\nline3');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });

    // Generate a very large diff (exceeding default limits)
    const largeDiff = `diff --git a/large.ts b/large.ts
--- a/large.ts
+++ b/large.ts
${Array(1000).fill('+new line').join('\n')}`;

    const fakeLLM = new FakeLLM(
      [{ goal: 'too big', files: ['large.ts'], changes: ['too big'], verify: 'test' }],
      [largeDiff]
    );

    const result = await runSalmonLoop({
      instruction: 'make it large',
      verify: 'echo "success"',
      repoPath: tempDir,
      llm: fakeLLM,
      allowDirty: true
    });

    expect(result.success).toBe(false);
    expect(result.failurePhase).toBe(ExecutionPhase.VALIDATE);
  });

  it('should reject dirty workspace by default', async () => {
    const filePath = join(tempDir, 'dirty.ts');
    await writeFile(filePath, 'initial content');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });
    
    // Make it dirty
    await writeFile(filePath, 'dirty content');

    const fakeLLM = new FakeLLM([], []);

    const result = await runSalmonLoop({
      instruction: 'any',
      verify: 'any',
      repoPath: tempDir,
      llm: fakeLLM
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Workspace has uncommitted changes');
    expect(result.failurePhase).toBe(ExecutionPhase.PREFLIGHT);
  });

  it('should reject allowDirty + forceReset combination', async () => {
    const fakeLLM = new FakeLLM([], []);

    const result = await runSalmonLoop({
      instruction: 'any',
      verify: 'any',
      repoPath: tempDir,
      llm: fakeLLM,
      allowDirty: true,
      forceReset: true
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Safety Guard');
    expect(result.failurePhase).toBe(ExecutionPhase.PREFLIGHT);
  });
});
