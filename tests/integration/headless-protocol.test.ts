import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/cli-runner.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Headless protocol integration', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

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
});
