import { describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  resolution: {
    enabled: true,
    proxyBaseUrl: 'https://proxy.example.test',
    proxyPathPrefix: '/v1',
  } as { enabled: boolean; proxyBaseUrl?: string; proxyPathPrefix?: string },
  reporterOptions: [] as Array<{
    proxyBaseUrl?: string;
    proxyPathPrefix?: string;
    litellmApiKey?: string;
  }>,
}))();

mock.module('../../../../src/integrations/langfuse/outcome-proxy.js', () => ({
  resolveLangfuseOutcomeProxyBaseUrl: mock(() => hoisted.resolution),
}));

mock.module('../../../../src/integrations/langfuse/litellm-langfuse-outcome-reporter.js', () => ({
  LiteLlmLangfuseOutcomeReporter: class {
    constructor(options: {
      proxyBaseUrl?: string;
      proxyPathPrefix?: string;
      litellmApiKey?: string;
    }) {
      hoisted.reporterOptions.push(options);
    }
  },
}));

describe('createOutcomeReporter', () => {
  it('returns undefined when reporting is disabled', async () => {
    hoisted.resolution = { enabled: false };
    const { createOutcomeReporter } = await import('../../../../src/cli/utils/outcome-reporter.js');

    const reporter = createOutcomeReporter({
      enabled: false,
      endpoint: 'https://langfuse.example.test',
      llmBaseUrl: 'https://llm.example.test',
      llmApiKey: 'key',
      proxyApiKeyEnv: 'env-key',
    });

    expect(reporter).toBeUndefined();
    expect(hoisted.reporterOptions.length).toBe(0);
  });

  it('uses proxyApiKeyEnv over llmApiKey when enabled', async () => {
    hoisted.resolution = {
      enabled: true,
      proxyBaseUrl: 'https://proxy.example.test',
      proxyPathPrefix: '/v1',
    };
    const { createOutcomeReporter } = await import('../../../../src/cli/utils/outcome-reporter.js');

    const reporter = createOutcomeReporter({
      enabled: true,
      endpoint: 'https://langfuse.example.test',
      llmBaseUrl: 'https://llm.example.test',
      llmApiKey: 'llm-key',
      proxyApiKeyEnv: 'env-key',
    });

    expect(reporter).toBeDefined();
    expect(hoisted.reporterOptions).toEqual([
      {
        proxyBaseUrl: 'https://proxy.example.test',
        proxyPathPrefix: '/v1',
        litellmApiKey: 'env-key',
      },
    ]);
  });
});
