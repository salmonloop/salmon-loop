import { text } from '../../src/locales/index.js';
import { runCli } from '../helpers/cli-runner.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Config CLI integration', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('loads default repo config and redacts inline apiKey in --print-config output', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          verify: { command: 'bun -e "process.exit(0)"' },
          llm: {
            activeModel: 'default',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                client: { package: '@ai-sdk/openai' },
                api: {
                  baseUrl: 'https://example.com/v1',
                  apiKey: 'secret-inline-key',
                  timeoutMs: 60000,
                  headers: {},
                },
              },
            },
            models: {
              default: {
                provider: 'openaiMain',
                id: 'gpt-test',
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout, stderr } = await runCli(['run', '-r', repo.path, '--print-config']);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);

    const printed = JSON.parse(stdout) as any;
    expect(printed.version).toBe(1);
    expect(printed.llm.providers.openaiMain.api.apiKey).toBe('[REDACTED]');
    expect(stdout).not.toContain('secret-inline-key');
  }, 120000);

  it('loads default repo config from YAML when config.yaml exists', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.yaml',
      `version: 1
verify:
  command: bun -e "process.exit(0)"
llm:
  active_model: default
  providers:
    openaiMain:
      type: openai-compatible
      api:
        base_url: https://example.com/v1
        api_key: secret-inline-key
  models:
    default:
      provider: openaiMain
      id: gpt-test
`,
    );

    const { exitCode, stdout, stderr } = await runCli(['run', '-r', repo.path, '--print-config']);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);

    const printed = JSON.parse(stdout) as any;
    expect(printed.version).toBe(1);
    expect(printed.llm.providers.openaiMain.api.apiKey).toBe('[REDACTED]');
    expect(stdout).not.toContain('secret-inline-key');
  }, 120000);

  it('fails when --config points to a missing file', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stderr } = await runCli([
      'run',
      '-r',
      repo.path,
      '--config',
      'does-not-exist.json',
      '--print-config',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(text.errors.technicalDetailsHidden);
  });

  it('does not load default repo config when --no-config-file is set', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          llm: {
            activeModel: 'default',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                api: { apiKey: 'secret-inline-key' },
              },
            },
            models: {
              default: {
                provider: 'openaiMain',
                id: 'gpt-test',
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout, stderr } = await runCli([
      'run',
      '-r',
      repo.path,
      '--no-config-file',
      '--print-config',
    ]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ version: 1 });
  }, 120000);

  it('fails with a readable error when default config contains invalid JSON', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(repo.path, '.salmonloop/config/config.json', '{');

    const { exitCode, stderr } = await runCli(['run', '-r', repo.path, '--print-config']);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(text.errors.technicalDetailsHidden);
  });

  it('fails with a readable error when config version is unsupported', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify({ version: 2 }, null, 2),
    );

    const { exitCode, stderr } = await runCli(['run', '-r', repo.path, '--print-config']);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(text.errors.technicalDetailsHidden);
  });
});
