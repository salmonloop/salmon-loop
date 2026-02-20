import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigError } from '../../src/core/config/errors.js';
import { redactConfigForPrint, resolveConfig } from '../../src/core/config/index.js';

function uniqueTmpDir(name: string): string {
  return join(tmpdir(), `salmonloop-config-test-${name}-${Date.now()}-${Math.random()}`);
}

describe('Config module', () => {
  it('loads repo-local config from .salmonloop/config/config.json and resolves inline apiKey', async () => {
    const repoRoot = uniqueTmpDir('repo');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          output: {
            markdown: {
              theme: 'vivid',
              mode: 'native',
            },
          },
          llm: {
            active: 'openaiMain',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                client: { package: '@ai-sdk/openai-compatible' },
                api: {
                  baseUrl: 'https://example.com/v1',
                  apiKey: 'inline-key',
                },
                models: {
                  default: { id: 'gpt-test' },
                },
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    vi.stubEnv('SALMONLOOP_API_KEY', 'env-key');

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.source.used).toBe(true);
    expect(cfg.llm.id).toBe('openaiMain');
    expect(cfg.llm.clientPackage).toBe('@ai-sdk/openai-compatible');
    expect(cfg.llm.api.baseUrl).toBe('https://example.com/v1');
    expect(cfg.llm.api.apiKey).toBe('inline-key');
    expect(cfg.llm.api.apiKeySource).toBe('inline');
    expect(cfg.llm.models.selectedModelId).toBe('gpt-test');
    expect(cfg.markdownTheme).toBe('vivid');
    expect(cfg.markdownRenderMode).toBe('native');
  });

  it('falls back to environment variables when config is missing', async () => {
    const repoRoot = uniqueTmpDir('repo-missing');

    vi.stubEnv('SALMONLOOP_API_KEY', 'env-key');
    vi.stubEnv('S8P_BASE_URL', 'https://env.example/v1');
    vi.stubEnv('S8P_MODEL', 'env-model');

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.source.used).toBe(false);
    expect(cfg.llm.api.apiKey).toBe('env-key');
    expect(cfg.llm.api.apiKeySource).toBe('env');
    expect(cfg.llm.api.baseUrl).toBe('https://env.example/v1');
    expect(cfg.llm.models.selectedModelId).toBe('env-model');
    expect(cfg.markdownTheme).toBe('default');
    expect(cfg.markdownRenderMode).toBe('enhanced');
  });

  it('prefers SALMONLOOP_MODEL over legacy envs', async () => {
    const repoRoot = uniqueTmpDir('repo-model');

    vi.stubEnv('SALMONLOOP_API_KEY', 'loop-key');
    vi.stubEnv('SALMONLOOP_MODEL', 'loop-model');
    vi.stubEnv('S8P_MODEL', 'legacy-model');

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.llm.models.selectedModelId).toBe('loop-model');
  });

  it('prefers SALMONLOOP_BASE_URL and trims trailing slashes', async () => {
    const repoRoot = uniqueTmpDir('repo-loop-base');

    vi.stubEnv('SALMONLOOP_API_KEY', 'env-key');
    vi.stubEnv('SALMONLOOP_BASE_URL', 'https://loop.example/v1/');
    vi.stubEnv('S8P_BASE_URL', 'https://legacy.example/v1/');

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.llm.api.baseUrl).toBe('https://loop.example/v1');
  });

  it('resolves observability.langfuse sessionId/userId from config', async () => {
    const repoRoot = uniqueTmpDir('repo-langfuse-ids');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          observability: {
            langfuse: {
              enabled: true,
              outcome: true,
              endpoint: 'https://litellm.example/langfuse/',
              sessionId: 'sess-1',
              userId: 'user-1',
            },
          },
          llm: {
            active: 'openaiMain',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                api: { baseUrl: 'https://example.com/v1', apiKey: 'inline-key' },
                models: { default: { id: 'gpt-test' } },
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.observability.langfuse.enabled).toBe(true);
    expect(cfg.observability.langfuse.outcome).toBe(true);
    expect(cfg.observability.langfuse.endpoint).toBe('https://litellm.example/langfuse/');
    expect(cfg.observability.langfuse.sessionId).toBe('sess-1');
    expect(cfg.observability.langfuse.userId).toBe('user-1');
  });

  it('prefers env overrides for observability.langfuse sessionId/userId', async () => {
    const repoRoot = uniqueTmpDir('repo-langfuse-ids-env');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          observability: {
            langfuse: {
              sessionId: 'sess-config',
              userId: 'user-config',
            },
          },
          llm: {
            active: 'openaiMain',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                api: { baseUrl: 'https://example.com/v1', apiKey: 'inline-key' },
                models: { default: { id: 'gpt-test' } },
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    vi.stubEnv('SALMONLOOP_LANGFUSE_SESSION_ID', 'sess-env');
    vi.stubEnv('SALMONLOOP_LANGFUSE_USER_ID', 'user-env');

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.observability.langfuse.sessionId).toBe('sess-env');
    expect(cfg.observability.langfuse.userId).toBe('user-env');
  });

  it('rejects invalid observability.langfuse sessionId/userId types', async () => {
    const repoRoot = uniqueTmpDir('repo-langfuse-ids-invalid');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          observability: {
            langfuse: {
              sessionId: 123,
              userId: false,
            },
          },
          llm: {
            active: 'openaiMain',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                api: { baseUrl: 'https://example.com/v1', apiKey: 'inline-key' },
                models: { default: { id: 'gpt-test' } },
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(resolveConfig({ repoRoot })).rejects.toBeInstanceOf(ConfigError);
  });

  it('redacts inline api keys for printing', () => {
    const redacted = redactConfigForPrint({
      version: 1,
      llm: {
        active: 'openaiMain',
        providers: {
          openaiMain: {
            type: 'openai-compatible',
            api: {
              apiKey: 'inline-key',
            },
            models: { default: { id: 'gpt-test' } },
          },
        },
      },
    });

    expect(redacted.llm?.providers?.openaiMain?.api?.apiKey).toBe('[REDACTED]');
  });
});
