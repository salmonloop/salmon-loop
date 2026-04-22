import { beforeEach, describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  reporterCalls: [] as Array<Record<string, unknown>>,
  startChatCalls: 0,
}))();

mock.module('../../../../src/cli/utils/outcome-reporter.js', () => ({
  createOutcomeReporter: mock((params: Record<string, unknown>) => {
    hoisted.reporterCalls.push(params);
    return { type: 'outcome-reporter' };
  }),
}));

mock.module('../../../../src/core/config/index.js', () => ({
  ConfigError: class ConfigError extends Error {},
  normalizePermissionMode: (raw: unknown) => {
    const v = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (v === 'interactive' || v === 'yolo') return v;
    return undefined;
  },
  normalizeUiLogMode: (raw: unknown) => {
    const v = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (v === 'quiet' || v === 'normal' || v === 'debug') return v;
    return undefined;
  },
  redactConfigForPrint: (v: any) => v,
  resolveConfig: mock(async () => ({
    llm: { api: { baseUrl: 'https://llm.example.test', apiKey: 'llm-key' } },
    llmOutput: { kinds: [] },
    observability: {
      langfuse: {
        enabled: true,
        outcome: true,
        endpoint: 'https://langfuse.example.test',
        apiKey: 'langfuse-key',
        apiKeySource: 'inline',
        sessionId: 'session-123',
        userId: 'user-456',
      },
      audit: { scope: 'repo' },
    },
    toolAuthorization: { allowlist: {} },
    verify: { command: undefined },
    markdownTheme: 'default',
    markdownRenderMode: 'enhanced',
    ui: { logView: 'summary', logMode: 'auto' },
    astValidation: { strictness: 'strict' },
  })),
}));

mock.module('../../../../src/core/observability/logger.js', () => ({
  getLogger: () => ({
    error: mock(),
    warn: mock(),
    info: mock(),
    debug: mock(),
    success: mock(),
    cyan: mock(),
    log: mock(),
    setReporter: mock(),
  }),
}));

mock.module('../../../../src/core/extensions/index.js', () => ({
  ExtensionConfigError: class ExtensionConfigError extends Error {},
  resolveExtensions: mock(async () => ({ resolved: { mcpServers: [], toolPlugins: [] } })),
}));

mock.module('../../../../src/core/llm/factory.js', () => ({
  createRuntimeLlm: mock(() => ({ llm: {} })),
}));

mock.module('../../../../src/core/plugin/loader.js', () => ({
  PluginLoader: { loadPlugins: mock(async () => {}) },
}));

mock.module('../../../../src/cli/utils/llm-output.js', () => ({
  resolveLlmOutputPolicyFromCli: mock(() => ({ ok: true, policy: { kinds: [] } })),
}));

mock.module('../../../../src/cli/utils/verify-resolver.js', () => ({
  resolveVerifyOption: mock(async () => undefined),
}));

mock.module('../../../../src/cli/chat.js', () => ({
  startChatMode: mock(async (options: Record<string, unknown>) => {
    hoisted.reporterCalls.push({ startChatMode: options });
    hoisted.startChatCalls += 1;
  }),
}));

describe('handleChatCommand outcome reporter', () => {
  beforeEach(() => {
    hoisted.reporterCalls.length = 0;
    hoisted.startChatCalls = 0;
  });

  it('uses shared outcome reporter helper', async () => {
    const { handleChatCommand } = await import('../../../../src/cli/commands/chat.js');

    const command: any = {
      optsWithGlobals: () => ({ repo: '/repo', auditScope: 'user' }),
    };

    await handleChatCommand({}, command);

    expect(hoisted.startChatCalls).toBe(1);
    expect(hoisted.reporterCalls.length).toBe(2);
    expect(hoisted.reporterCalls[0]).toEqual({
      enabled: true,
      endpoint: 'https://langfuse.example.test',
      llmBaseUrl: 'https://llm.example.test',
      langfuseApiKey: 'langfuse-key',
    });
    const startChatCall = hoisted.reporterCalls[1]?.startChatMode as Record<string, unknown>;
    expect(startChatCall?.auditScope).toBe('user');
  });

  it('defaults chat to autopilot flow mode and yolo permission mode when implicit', async () => {
    const { handleChatCommand } = await import('../../../../src/cli/commands/chat.js');
    const command: any = {
      optsWithGlobals: () => ({
        repo: '/repo',
        auditScope: 'user',
        mode: 'interactive',
        checkpointStrategy: 'worktree',
      }),
      getOptionValueSource: (name: string) =>
        name === 'checkpointStrategy' || name === 'mode' ? 'default' : 'cli',
    };

    await handleChatCommand({}, command);

    const startChatCall = hoisted.reporterCalls[1]?.startChatMode as Record<string, unknown>;
    expect(startChatCall?.defaultFlowMode).toBe('autopilot');
    expect(startChatCall?.permissionMode).toBe('yolo');
    expect(startChatCall?.checkpointStrategy).toBe('direct');
  });
});
