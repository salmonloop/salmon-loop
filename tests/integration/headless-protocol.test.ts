import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { runCli } from '../helpers/cli-runner.js';
import {
  normalizeHeadlessIntegrationLines,
  pickAnthropicLifecycleLines,
  pickNativeLifecycleLines,
  pickOpenAiLifecycleLines,
  readJsonFixture,
} from '../helpers/headless-golden.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Headless protocol integration', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  async function seedChatSession(repoPath: string, sessionId: string) {
    await helper.writeFile(
      repoPath,
      `.salmonloop/chat-sessions/${sessionId}.json`,
      JSON.stringify(
        {
          meta: {
            id: sessionId,
            name: 'Test Session',
            repoPath,
            createdAt: 0,
            updatedAt: 0,
            totalIterations: 0,
            successfulIterations: 0,
            totalTokens: { input: 0, output: 0 },
            snapshots: [],
          },
          messages: [],
          iterations: [],
        },
        null,
        2,
      ),
    );
  }

  it('supports global -p print mode with --output-format json (implicit run command)', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout) as any;
    expect(payload.session_id).toBeTruthy();
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: true,
      exit_code: 0,
    });
  }, 120000);

  it('supports global -p print mode with --output-format stream-json (implicit run command)', async () => {
    const repo = await helper.createGitRepo();
    await seedChatSession(repo.path, 'sess-print');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-print',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toMatchObject({
      session_id: 'sess-print',
      event: { type: 'start', command: 'run', repo_path: repo.path, instruction: 'hello' },
    });

    const resultLine = lines.find((l) => l.event?.type === 'result');
    const endLine = lines[lines.length - 1];
    expect(resultLine).toMatchObject({
      session_id: 'sess-print',
      event: { type: 'result', success: true, exit_code: 0 },
    });
    expect(endLine).toMatchObject({
      session_id: 'sess-print',
      event: { type: 'end', success: true, exit_code: 0 },
    });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickNativeLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL('../fixtures/headless/integration/print-stream-json-native.json', import.meta.url),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('supports global -p print mode with --output-format stream-json --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();
    await seedChatSession(repo.path, 'sess-print-anthropic');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-print-anthropic',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      type: 'start',
      session_id: 'sess-print-anthropic',
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
    });
    expect(lines[1]).toMatchObject({
      type: 'result',
      session_id: 'sess-print-anthropic',
      success: true,
      exit_code: 0,
    });
    expect(lines[2]).toMatchObject({
      type: 'end',
      session_id: 'sess-print-anthropic',
      success: true,
      exit_code: 0,
    });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickAnthropicLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL('../fixtures/headless/integration/print-stream-json-anthropic.json', import.meta.url),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('supports global -p print mode with --output-format stream-json --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toMatchObject({ type: 'response.created', sequence_number: 0 });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress', sequence_number: 1 });

    const last = lines[lines.length - 1];
    expect(last).toMatchObject({
      type: 'response.completed',
      response: { object: 'response', output_text: expect.any(String) },
    });
    expect(String(last.response.output_text).length).toBeGreaterThan(0);

    const sequenceNumbers = lines.map((l) => l.sequence_number);
    expect(sequenceNumbers).toEqual([...sequenceNumbers.keys()]);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL('../fixtures/headless/integration/print-stream-json-openai.json', import.meta.url),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('supports --continue selecting the latest session in headless stream-json', async () => {
    const repo = await helper.createGitRepo();
    await seedChatSession(repo.path, 'sess-old');
    await new Promise((r) => setTimeout(r, 10));
    await seedChatSession(repo.path, 'sess-new');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--continue',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines[0]).toMatchObject({
      session_id: 'sess-new',
      event: { type: 'start', command: 'run', repo_path: repo.path, instruction: 'hello' },
    });
  }, 120000);

  it('fails fast when context cache path is outside allowed roots in headless stream-json', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          context: {
            cache: {
              mode: 'persistent',
              path: '../outside/context-cache.json',
              allowedRoots: ['.salmonloop/cache'],
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any);
    const retryEvents = lines.filter((line) => line.event?.type === 'retry');
    const resultEvent = lines.find((line) => line.event?.type === 'result');
    expect(retryEvents).toHaveLength(0);
    expect(resultEvent?.event?.error_code).toBe('PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT');
    expect(lines[lines.length - 1]).toMatchObject({
      event: { type: 'end', success: false, exit_code: 1 },
    });
  }, 120000);

  it('allows one-off outside-root context cache path with --allow-outside-cache-root in headless stream-json', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          context: {
            cache: {
              mode: 'persistent',
              path: '../outside/context-cache.json',
              allowedRoots: ['.salmonloop/cache'],
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--allow-outside-cache-root',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any);
    const retryEvents = lines.filter((line) => line.event?.type === 'retry');
    const resultEvent = lines.find((line) => line.event?.type === 'result');
    expect(retryEvents).toHaveLength(0);
    expect(resultEvent?.event?.success).toBe(true);
    expect(resultEvent?.event?.error_code).toBeUndefined();
    expect(lines[lines.length - 1]).toMatchObject({
      event: { type: 'end', success: true, exit_code: 0 },
    });
  }, 120000);

  it('supports deferred non-interactive permission approval and records requestId in audit', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          context: {
            cache: {
              mode: 'persistent',
              path: '../outside/context-cache.json',
              allowedRoots: ['.salmonloop/cache'],
            },
          },
          toolAuthorization: {
            nonInteractive: {
              strategy: 'command',
              command: {
                cmd:
                  process.platform === 'win32'
                    ? `bun -e "console.log(JSON.stringify({ outcome: 'allow_once' }));"`
                    : `bun -e 'console.log(JSON.stringify({ outcome: "allow_once" }));'`,
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any);
    const retryEvents = lines.filter((line) => line.event?.type === 'retry');
    const resultEvent = lines.find((line) => line.event?.type === 'result');
    expect(retryEvents).toHaveLength(0);
    expect(resultEvent?.event?.attempts).toBe(1);
    expect(resultEvent?.event?.success).toBe(true);
    expect(resultEvent?.event?.audit_path).toBeTruthy();

    const auditPath = String(resultEvent?.event?.audit_path ?? '');
    expect(auditPath.length).toBeGreaterThan(0);
    const auditRaw = await helper.readFile(repo.path, path.relative(repo.path, auditPath), 'utf-8');
    const audit = JSON.parse(String(auditRaw)) as any;
    const eventsRefPath = String(audit.context?.eventsRef?.path ?? '');
    expect(eventsRefPath.length).toBeGreaterThan(0);
    const eventsRaw = await helper.readFile(
      repo.path,
      `.salmonloop/runtime/audit/${eventsRefPath}`,
      'utf-8',
    );
    const events = String(eventsRaw)
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any);
    const permissionEvent = events.find((e: any) => e.action === 'permission.decision');
    expect(permissionEvent?.details?.decision).toBe('pending');
    expect(typeof permissionEvent?.details?.requestId).toBe('string');
    expect(permissionEvent?.details?.requestId.length).toBeGreaterThan(0);
  }, 120000);

  it('emits machine-readable errors when --resume session is missing in headless stream-json (native)', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickNativeLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-native.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable errors when --resume session is corrupted in headless stream-json (native)', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(repo.path, '.salmonloop/chat-sessions/sess-missing.json', '{');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickNativeLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-native.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable errors when --resume session is missing in headless stream-json --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing-anthropic',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickAnthropicLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-anthropic.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable errors when --resume session is corrupted in headless stream-json --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(repo.path, '.salmonloop/chat-sessions/sess-missing-anthropic.json', '{');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing-anthropic',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickAnthropicLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-anthropic.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits OpenAI-compatible errors when --resume session is missing in headless stream-json --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing-openai',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-openai.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits OpenAI-compatible errors when --resume session is corrupted in headless stream-json --output-profile openai', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(repo.path, '.salmonloop/chat-sessions/sess-missing-openai.json', '{');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing-openai',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-openai.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable unexpected errors when repo path is not a directory in headless stream-json (native)', async () => {
    const dir = await helper.createTempDir('not-a-repo-');
    const repoPath = path.join(dir, 'repo.txt');
    await helper.writeFile(dir, 'repo.txt', 'x');

    const { exitCode, stdout } = await runCli([
      '-r',
      repoPath,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const simplified = pickNativeLifecycleLines(lines).map((l) => ({
      ...l,
      session_id: '<session>',
    }));
    const normalized = normalizeHeadlessIntegrationLines({
      lines: simplified,
      repoPath,
    });

    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/unexpected-error-stream-json-native.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable unexpected errors when repo path is not a directory in headless stream-json --output-profile anthropic', async () => {
    const dir = await helper.createTempDir('not-a-repo-');
    const repoPath = path.join(dir, 'repo.txt');
    await helper.writeFile(dir, 'repo.txt', 'x');

    const { exitCode, stdout } = await runCli([
      '-r',
      repoPath,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const simplified = pickAnthropicLifecycleLines(lines).map((l) => ({
      ...l,
      session_id: '<session>',
    }));
    const normalized = normalizeHeadlessIntegrationLines({
      lines: simplified,
      repoPath,
    });

    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/unexpected-error-stream-json-anthropic.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits OpenAI-compatible unexpected errors when repo path is not a directory in headless stream-json --output-profile openai', async () => {
    const dir = await helper.createTempDir('not-a-repo-');
    const repoPath = path.join(dir, 'repo.txt');
    await helper.writeFile(dir, 'repo.txt', 'x');

    const { exitCode, stdout } = await runCli([
      '-r',
      repoPath,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/unexpected-error-stream-json-openai.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable usage errors for Commander parse errors in headless json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--unknown-flag',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: false,
      exit_code: 1,
      error_code: 'USAGE_ERROR',
    });
    expect(String(payload.metadata.reason)).toContain('unknown option');
  }, 120000);

  it('emits machine-readable usage errors for Commander parse errors in headless stream-json (native)', async () => {
    const repo = await helper.createGitRepo();
    await seedChatSession(repo.path, 'sess-usage-native');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-usage-native',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--unknown-flag',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines[0]).toMatchObject({
      session_id: 'sess-usage-native',
      event: { type: 'start', command: 'run', repo_path: repo.path, instruction: 'hello' },
    });
    expect(lines.some((l) => l.event?.type === 'error')).toBe(true);
    expect(lines[lines.length - 1]).toMatchObject({
      session_id: 'sess-usage-native',
      event: { type: 'end', success: false, exit_code: 1 },
    });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickNativeLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/usage-error-stream-json-native.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits OpenAI-compatible usage errors for Commander parse errors in headless stream-json --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--unknown-flag',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(
      lines.every((l) => typeof l.type === 'string' && typeof l.sequence_number === 'number'),
    ).toBe(true);
    expect(lines.some((l) => l.type === 'error')).toBe(true);
  }, 120000);

  it('prints machine-readable usage errors for --continue/--resume conflict when --output-format stream-json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '--continue',
      '--resume',
      'sess-conflict',
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ session_id: 'sess-conflict', event: { type: 'start' } });
    expect(lines[1]).toMatchObject({
      session_id: 'sess-conflict',
      event: {
        type: 'error',
        error: { message: expect.stringContaining('continue') },
      },
    });
    expect(lines[2]).toMatchObject({
      session_id: 'sess-conflict',
      event: { type: 'end', success: false, exit_code: 1 },
    });
  }, 120000);

  it('prints machine-readable usage errors for -p/-i conflict when --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '--resume',
      'sess-print-conflict',
      '-p',
      'hello',
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      type: 'start',
      session_id: 'sess-print-conflict',
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
    });
    expect(lines[1]).toMatchObject({
      type: 'error',
      session_id: 'sess-print-conflict',
      error: { message: expect.stringContaining('--print') },
    });
    expect(lines[2]).toMatchObject({
      type: 'end',
      session_id: 'sess-print-conflict',
      success: false,
      exit_code: 1,
    });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickAnthropicLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/usage-error-stream-json-anthropic.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('prints OpenAI-compatible usage errors when --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '--resume',
      'sess-openai',
      '-p',
      'hello',
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created' });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress' });
    expect(lines[2]).toMatchObject({ type: 'error' });
    expect(lines[3]).toMatchObject({ type: 'response.failed' });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/usage-error-stream-json-openai.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('prints OpenAI-compatible usage errors for --json-schema when --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--json-schema',
      '{}',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created' });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress' });
    expect(lines[2]).toMatchObject({ type: 'error' });
    expect(lines[3]).toMatchObject({ type: 'response.failed' });
  }, 120000);

  it('rejects tool payload flags when --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--headless-include-tool-input',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created' });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress' });
    expect(lines[2]).toMatchObject({ type: 'error' });
    expect(lines[3]).toMatchObject({ type: 'response.failed' });
  }, 120000);

  it('rejects authorization decision flags when --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--headless-include-authorization-decisions',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created' });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress' });
    expect(lines[2]).toMatchObject({ type: 'error' });
    expect(lines[3]).toMatchObject({ type: 'response.failed' });
  }, 120000);

  it('prints machine-readable usage errors when --output-format stream-json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--json-schema',
      '{}',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines[0]).toMatchObject({ event: { type: 'start' } });
    expect(lines[1]).toMatchObject({
      event: {
        type: 'error',
        error: { message: expect.stringContaining('--json-schema') },
      },
    });
    expect(lines[2]).toMatchObject({ event: { type: 'end', success: false, exit_code: 1 } });
  }, 120000);

  it('prints machine-readable usage errors when --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--json-schema',
      '{}',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines[0]).toMatchObject({ type: 'start', command: 'run' });
    expect(lines[1]).toMatchObject({
      type: 'error',
      error: { message: expect.stringContaining('--json-schema') },
    });
    expect(lines[2]).toMatchObject({ type: 'end', success: false, exit_code: 1 });
  }, 120000);

  it('fails the run if schema validation fails (strict mode)', async () => {
    const repo = await helper.createGitRepo();
    const schema = JSON.stringify({
      type: 'object',
      required: ['foo'],
      properties: { foo: { type: 'string' } },
      additionalProperties: true,
    });

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'json',
      '--json-schema',
      schema,
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      success: false,
      exit_code: 1,
      reason_code: 'SCHEMA_VALIDATION_FAILED',
      error_code: 'SCHEMA_VALIDATION_FAILED',
    });
  }, 120000);

  it('rejects --output-profile when --output-format is json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'json',
      '--output-profile',
      'native',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      success: false,
      exit_code: 1,
    });
    expect(String(payload.metadata.reason)).toContain('--output-profile');
  }, 120000);

  it('emits structured_output when schema validation succeeds', async () => {
    const repo = await helper.createGitRepo();
    const schema = JSON.stringify({
      type: 'object',
      required: ['command', 'repo_path', 'instruction', 'session_id', 'success', 'exit_code'],
      properties: {
        command: { const: 'run' },
        repo_path: { type: 'string' },
        instruction: { type: 'string' },
        session_id: { type: 'string' },
        success: { type: 'boolean' },
        exit_code: { type: 'number' },
      },
      additionalProperties: true,
    });

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--json-schema',
      schema,
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: true,
      exit_code: 0,
    });
  }, 120000);

  it('fails strictly when structured output schema validation fails (loop success -> headless failure)', async () => {
    const repo = await helper.createGitRepo();
    const schema = JSON.stringify({
      type: 'object',
      required: ['command'],
      properties: {
        command: { const: 'chat' },
      },
      additionalProperties: true,
    });

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--json-schema',
      schema,
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: false,
      exit_code: 1,
      reason_code: 'SCHEMA_VALIDATION_FAILED',
      error_code: 'SCHEMA_VALIDATION_FAILED',
    });
    expect(String(payload.metadata.structured_output_error)).toContain('schema validation');
  }, 120000);

  it('fails strictly when the JSON schema input is invalid', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--json-schema',
      '{',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: false,
      exit_code: 1,
      reason_code: 'SCHEMA_VALIDATION_FAILED',
      error_code: 'SCHEMA_INVALID',
    });
    expect(String(payload.metadata.reason)).toContain('Failed to load JSON schema');
  }, 120000);
});
