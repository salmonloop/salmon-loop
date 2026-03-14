import { spawn } from 'child_process';
import { join, resolve } from 'path';

import { describe, expect, it, afterEach } from 'bun:test';

import {
  prepareRepo,
  readRepoFile,
  runScenario,
  runWithFallback,
  waitForAuditDir,
  type OutputFormat,
  type Strategy,
} from './harness.js';

const PROJECT_ROOT = resolve(process.cwd());
const CLI_ENTRY = join(PROJECT_ROOT, 'src', 'cli', 'index.ts');

const SUCCESS_VERIFY =
  "node -e \"const fs=require('fs');const c=fs.readFileSync('example.txt','utf8');if(!c.includes('Hello World'))process.exit(1);if(!c.includes('End Test'))process.exit(1);\"";

const PASS_VERIFY = 'node -e "process.exit(0)"';

const MODES: Array<{ label: string; strategy: Strategy; environmentMode: 'strict' | 'parity' }> = [
  { label: 'direct', strategy: 'direct', environmentMode: 'strict' },
  { label: 'worktree-strict', strategy: 'worktree', environmentMode: 'strict' },
  { label: 'worktree-parity', strategy: 'worktree', environmentMode: 'parity' },
];

const OUTPUTS: OutputFormat[] = ['text', 'json', 'stream-json'];

const cleanupQueue: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupQueue.length > 0) {
    const cleanup = cleanupQueue.pop();
    if (cleanup) await cleanup();
  }
});

function findStreamResult(outputJsonl: any[] | undefined): any {
  return outputJsonl?.find((line) => line?.event?.type === 'result')?.event;
}

function buildRepoFiles() {
  return [{ path: 'example.txt', content: 'Hello\nTest\nEnd\n' }];
}

describe('E2E CLI (black-box)', () => {
  it(
    'success path works across modes and outputs',
    async () => {
      for (const mode of MODES) {
        for (const outputFormat of OUTPUTS) {
          const repo = await prepareRepo({
            strategy: mode.strategy,
            verifyCommand: SUCCESS_VERIFY,
            files: buildRepoFiles(),
          });
          cleanupQueue.push(repo.cleanup);

          const result = await runWithFallback(repo.path, {
            instruction:
              'Modify example.txt so line 1 is "Hello World" and line 3 is "End Test". Do not change other files.',
            outputFormat,
            environmentMode: mode.environmentMode,
            strategy: mode.strategy,
            allowFallback: true,
          });

          expect(result.exitCode).toBe(0);
          expect(result.audit.meta.success).toBe(true);

          if (outputFormat === 'json') {
            expect(result.outputJson?.metadata?.success).toBe(true);
          }
          if (outputFormat === 'stream-json') {
            const event = findStreamResult(result.outputJsonl);
            expect(event?.success).toBe(true);
          }

          const content = await readRepoFile(repo.path, 'example.txt');
          expect(content).toContain('Hello World');
          expect(content).toContain('End Test');
        }
      }
    },
    { timeout: 30000 },
  );

  it('dependency missing yields actionable diagnostics (strict, json)', async () => {
    const repo = await prepareRepo({
      strategy: 'worktree',
      verifyCommand: 'node -e "require(\'fast-xml-parser\')"',
      files: buildRepoFiles(),
    });
    cleanupQueue.push(repo.cleanup);

    const result = await runScenario(repo.path, {
      instruction: 'Touch example.txt only.',
      outputFormat: 'json',
      environmentMode: 'strict',
      strategy: 'worktree',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.audit.meta.reasonCode).toBe('VERIFY_FAILED');
    expect(result.audit.meta.failurePhase).toBe('VERIFY');

    const meta = result.outputJson?.metadata;
    expect(meta?.diagnostic_code).toBe('UNDECLARED_DEPENDENCY');
    expect(meta?.safe_hint).toContain('fast-xml-parser');
    expect(Array.isArray(meta?.remediation_steps)).toBe(true);
  });

  it('dependency missing yields actionable diagnostics (strict, stream-json)', async () => {
    const repo = await prepareRepo({
      strategy: 'worktree',
      verifyCommand: 'node -e "require(\'fast-xml-parser\')"',
      files: buildRepoFiles(),
    });
    cleanupQueue.push(repo.cleanup);

    const result = await runScenario(repo.path, {
      instruction: 'Touch example.txt only.',
      outputFormat: 'stream-json',
      environmentMode: 'strict',
      strategy: 'worktree',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.audit.meta.reasonCode).toBe('VERIFY_FAILED');

    const event = findStreamResult(result.outputJsonl);
    expect(event?.diagnostic_code).toBe('UNDECLARED_DEPENDENCY');
    expect(event?.safe_hint).toContain('fast-xml-parser');
    expect(Array.isArray(event?.remediation_steps)).toBe(true);
  });

  it('preflight dirty fails in direct mode', async () => {
    const repo = await prepareRepo({
      strategy: 'direct',
      verifyCommand: PASS_VERIFY,
      files: buildRepoFiles(),
      dirtyFile: { path: 'example.txt', content: 'Hello\nDirty\nEnd\n' },
    });
    cleanupQueue.push(repo.cleanup);

    const result = await runScenario(repo.path, {
      instruction: 'Modify example.txt to include Hello World.',
      outputFormat: 'text',
      environmentMode: 'strict',
      strategy: 'direct',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.audit.meta.reasonCode).toBe('PREFLIGHT_DIRTY');
  });

  it('verify failure triggers rollback (worktree parity)', async () => {
    const repo = await prepareRepo({
      strategy: 'worktree',
      verifyCommand: 'node -e "process.exit(2)"',
      files: buildRepoFiles(),
    });
    cleanupQueue.push(repo.cleanup);

    const result = await runScenario(repo.path, {
      instruction: 'Modify example.txt so line 1 is "Hello World".',
      outputFormat: 'json',
      environmentMode: 'parity',
      strategy: 'worktree',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.audit.meta.failurePhase).toBe('VERIFY');
    expect(result.audit.meta.reasonCode).toBe('MAX_RETRIES');
    expect(result.audit.context?.verifyResult?.ok).toBe(false);
    expect(result.audit.context?.verifyResult?.exitCode).toBe(2);

    const content = await readRepoFile(repo.path, 'example.txt');
    expect(content).toBe('Hello\nTest\nEnd\n');
  });

  it(
    'interrupt cancels the run with exit code 130',
    async () => {
      const repo = await prepareRepo({
        strategy: 'direct',
        verifyCommand: 'node -e "setTimeout(()=>{}, 20000)"',
        files: buildRepoFiles(),
      });
      cleanupQueue.push(repo.cleanup);

      const args = [
        'run',
        '--repo',
        repo.path,
        '--instruction',
        'Modify example.txt to include Hello World.',
        '--environment-mode',
        'strict',
        '--output-format',
        'text',
        '--checkpoint-strategy',
        'direct',
      ];

      const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
        cwd: repo.path,
        env: process.env,
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
      });

      const exitCodePromise: Promise<number> = new Promise((resolve) => {
        child.on('close', (code, signal) => {
          if (typeof code === 'number') return resolve(code);
          if (signal === 'SIGINT') return resolve(130);
          return resolve(0);
        });
      });

      await waitForAuditDir(repo.path);
      child.kill('SIGINT');

      const exitCode = await exitCodePromise;

      expect(exitCode).toBe(130);
    },
    { timeout: 20000 },
  );

  it(
    'apply-back conflict fails when base is dirty (worktree strict)',
    async () => {
      const repo = await prepareRepo({
        strategy: 'worktree',
        verifyCommand: PASS_VERIFY,
        files: [
          { path: 'example.txt', content: 'Hello\nTest\nEnd\n' },
          { path: 'other.txt', content: 'Dirty\n' },
        ],
        dirtyFile: { path: 'other.txt', content: 'Dirty\nChanged\n' },
      });
      cleanupQueue.push(repo.cleanup);

      const result = await runScenario(repo.path, {
        instruction: 'Modify example.txt so line 1 is "Hello World".',
        outputFormat: 'text',
        environmentMode: 'strict',
        strategy: 'worktree',
        applyBackOnDirty: 'abort',
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.audit.meta.reasonCode).toBe('APPLY_BACK_FAILED');
      expect(result.audit.meta.failurePhase).toBe('APPLY_BACK');
    },
    { timeout: 20000 },
  );
});
