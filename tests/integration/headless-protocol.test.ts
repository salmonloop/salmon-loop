import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/cli-runner.js';
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
      '--mode',
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
