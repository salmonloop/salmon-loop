import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it, vi } from 'vitest';

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
