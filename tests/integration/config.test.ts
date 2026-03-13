import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigError } from '../../src/core/config/errors.js';
import { redactConfigForPrint, resolveConfig } from '../../src/core/config/index.js';

const envRestoreMap = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined) {
  if (!envRestoreMap.has(key)) {
    envRestoreMap.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function uniqueTmpDir(name: string): string {
  return join(tmpdir(), `salmonloop-config-test-${name}-${Date.now()}-${Math.random()}`);
}

function llmConfig(modelId: string, extra?: Record<string, unknown>) {
  return {
    activeModel: 'default',
    providers: {
      openaiMain: {
        type: 'openai-compatible',
        client: { package: '@ai-sdk/openai-compatible' },
        api: {
          baseUrl: 'https://example.com/v1',
          apiKey: 'inline-key',
        },
      },
    },
    models: {
      default: {
        provider: 'openaiMain',
        id: modelId,
      },
    },
    ...(extra || {}),
  };
}

describe('Config module', () => {
  beforeEach(async () => {
    const tempHome = uniqueTmpDir('home');
    await mkdir(tempHome, { recursive: true });
    setEnv('HOME', tempHome);
    setEnv('USERPROFILE', tempHome);
    setEnv('SALMONLOOP_USER_CONFIG_HOME', tempHome);
  });

  afterEach(() => {
    for (const [key, value] of envRestoreMap) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    envRestoreMap.clear();
  });

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
            ...llmConfig('gpt-test'),
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    setEnv('SALMONLOOP_API_KEY', 'env-key');

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
    setEnv('SALMONLOOP_BASE_URL', undefined);
    setEnv('S8P_BASE_URL', undefined);
    setEnv('SALMONLOOP_MODEL', undefined);
    setEnv('S8P_MODEL', undefined);
    setEnv('SALMONLOOP_API_KEY', 'env-key');
    setEnv('S8P_BASE_URL', 'https://env.example/v1');
    setEnv('S8P_MODEL', 'env-model');

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

    setEnv('SALMONLOOP_API_KEY', 'loop-key');
    setEnv('SALMONLOOP_MODEL', 'loop-model');
    setEnv('S8P_MODEL', 'legacy-model');

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.llm.models.selectedModelId).toBe('loop-model');
  });

  it('prefers SALMONLOOP_BASE_URL and trims trailing slashes', async () => {
    const repoRoot = uniqueTmpDir('repo-loop-base');

    setEnv('SALMONLOOP_API_KEY', 'env-key');
    setEnv('SALMONLOOP_BASE_URL', 'https://loop.example/v1/');
    setEnv('S8P_BASE_URL', 'https://legacy.example/v1/');

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
            ...llmConfig('gpt-test'),
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
            ...llmConfig('gpt-test'),
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    setEnv('SALMONLOOP_LANGFUSE_SESSION_ID', 'sess-env');
    setEnv('SALMONLOOP_LANGFUSE_USER_ID', 'user-env');

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
            ...llmConfig('gpt-test'),
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(resolveConfig({ repoRoot })).rejects.toBeInstanceOf(ConfigError);
  });

  it('resolves astValidation.strictness from config', async () => {
    const repoRoot = uniqueTmpDir('repo-ast-validation');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          astValidation: {
            strictness: 'strict',
          },
          llm: {
            ...llmConfig('gpt-test'),
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.astValidation.strictness).toBe('strict');
  });

  it('rejects invalid astValidation.strictness values', async () => {
    const repoRoot = uniqueTmpDir('repo-ast-validation-invalid');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          astValidation: {
            strictness: 'hardcore',
          },
          llm: {
            ...llmConfig('gpt-test'),
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(resolveConfig({ repoRoot })).rejects.toBeInstanceOf(ConfigError);
  });

  it('resolves llm.routing.phaseToModel from config without changing selected model', async () => {
    const repoRoot = uniqueTmpDir('repo-phase-to-model');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          llm: {
            ...llmConfig('gpt-default', {
              models: {
                default: {
                  provider: 'openaiMain',
                  id: 'gpt-default',
                },
                planModel: {
                  provider: 'openaiMain',
                  id: 'gpt-plan',
                },
                patchModel: {
                  provider: 'openaiMain',
                  id: 'gpt-patch',
                },
              },
              routing: {
                phaseToModel: {
                  PLAN: 'planModel',
                  PATCH: 'patchModel',
                },
              },
            }),
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.llm.models.selectedModelId).toBe('gpt-default');
    expect(cfg.llm.routing?.phaseToModel).toEqual({
      PLAN: 'planModel',
      PATCH: 'patchModel',
    });
    expect(cfg.llm.routing?.phaseToProviderModel?.PLAN?.model.id).toBe('gpt-plan');
    expect(cfg.llm.routing?.phaseToProviderModel?.PATCH?.model.id).toBe('gpt-patch');
  });

  it('rejects invalid llm.routing.phaseToModel values', async () => {
    const repoRoot = uniqueTmpDir('repo-phase-to-model-invalid');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          llm: {
            activeModel: 'default',
            routing: {
              phaseToModel: {
                PLAN: 123,
              },
            },
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                api: { baseUrl: 'https://example.com/v1', apiKey: 'inline-key' },
              },
            },
            models: {
              default: {
                provider: 'openaiMain',
                id: 'gpt-default',
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

  it('resolves context.dynamicBudget alert thresholds from config', async () => {
    const repoRoot = uniqueTmpDir('repo-dynamic-budget-alert-thresholds');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          context: {
            dynamicBudget: {
              enabled: true,
              alerts: {
                truncationRateWarn: 0.7,
                criticalDropRateWarn: 0.05,
              },
            },
          },
          llm: {
            ...llmConfig('gpt-default'),
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const cfg = await resolveConfig({ repoRoot });
    expect(cfg.context.dynamicBudget.alerts.truncationRateWarn).toBe(0.7);
    expect(cfg.context.dynamicBudget.alerts.criticalDropRateWarn).toBe(0.05);
  });

  it('rejects invalid context.dynamicBudget alert thresholds', async () => {
    const repoRoot = uniqueTmpDir('repo-dynamic-budget-alert-thresholds-invalid');
    await mkdir(join(repoRoot, '.salmonloop', 'config'), { recursive: true });

    await writeFile(
      join(repoRoot, '.salmonloop', 'config', 'config.json'),
      JSON.stringify(
        {
          version: 1,
          context: {
            dynamicBudget: {
              enabled: true,
              alerts: {
                truncationRateWarn: 'high',
              },
            },
          },
          llm: {
            ...llmConfig('gpt-default'),
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
        activeModel: 'default',
        providers: {
          openaiMain: {
            type: 'openai-compatible',
            api: {
              apiKey: 'inline-key',
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
    });

    expect(redacted.llm?.providers?.openaiMain?.api?.apiKey).toBe('[REDACTED]');
  });
});
