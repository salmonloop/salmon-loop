import { describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  reporterCalls: [] as Array<Record<string, unknown>>,
  loopParamsCalls: [] as Array<Record<string, unknown>>,
}))();

mock.module('../../../../src/cli/utils/outcome-reporter.js', () => ({
  createOutcomeReporter: mock((params: Record<string, unknown>) => {
    hoisted.reporterCalls.push(params);
    return { type: 'outcome-reporter' };
  }),
}));

mock.module('../../../../src/cli/commands/run/parse-options.js', () => ({
  parseRunCommandOptions: mock(() => ({
    allOptions: {
      gui: false,
      validate: false,
      mode: 'patch',
      verbose: false,
      dryRun: false,
      forceReset: false,
      file: undefined,
      selection: undefined,
      checkpointStrategy: 'worktree',
      environmentMode: undefined,
      applyBackOnDirty: '3way',
      auditScope: 'user',
    },
    repoPath: '/repo',
    continueSession: false,
    resumeSessionId: undefined,
    printInstruction: undefined,
    explicitInstruction: undefined,
    jsonSchemaSpec: undefined,
    rawOutputFormat: 'text',
    rawOutputProfile: undefined,
    outputProfileForStreamJson: undefined,
    headlessIncludeToolInput: false,
    headlessIncludeToolOutput: false,
    headlessIncludeAuthorizationDecisions: false,
    allowOutsideCacheRoot: false,
    instruction: 'fix bug',
    auditScope: 'user',
    allowedToolRules: [],
    disallowedToolRules: [],
  })),
}));

mock.module('../../../../src/cli/commands/run/early-errors.js', () => ({
  handleEarlyRunCommandErrors: mock(() => ({ ok: true })),
}));

mock.module('../../../../src/cli/commands/run/config-resolution.js', () => ({
  resolveRunConfig: mock(async () => ({
    ok: true,
    resolvedConfig: {
      source: { used: false, path: undefined },
      observability: {
        langfuse: {
          enabled: true,
          outcome: true,
          endpoint: 'https://langfuse.example.test',
          sessionId: 'session-123',
          userId: 'user-456',
        },
        audit: { scope: 'repo' },
      },
      llm: { api: { baseUrl: 'https://llm.example.test', apiKey: 'llm-key' }, models: {} },
      llmOutput: { kinds: [] },
      markdownTheme: 'default',
      markdownRenderMode: 'enhanced',
      ui: { logView: 'summary', logMode: 'auto' },
      toolAuthorization: { allowlist: {} },
      astValidation: { strictness: 'strict' },
    },
  })),
}));

mock.module('../../../../src/cli/commands/run/runtime-options.js', () => ({
  resolveRunRuntimeOptions: mock(async () => ({
    ok: true,
    llmOutput: { kinds: [] },
    effectiveVerify: undefined,
    effectiveWorktreePrepare: undefined,
  })),
}));

mock.module('../../../../src/cli/commands/run/instruction-guard.js', () => ({
  ensureInstructionOrExit: mock(() => ({ ok: true })),
}));

mock.module('../../../../src/cli/commands/run/mode.js', () => ({
  resolveRunMode: mock(() => 'patch'),
}));

mock.module('../../../../src/cli/commands/run/extensions-resolution.js', () => ({
  resolveRunExtensions: mock(async () => ({ ok: true, extensionResolution: { resolved: [] } })),
}));

mock.module('../../../../src/cli/commands/run/runtime-llm.js', () => ({
  createRuntimeLlmAndWarn: mock(() => ({ llm: { getModelId: () => undefined }, warnings: [] })),
}));

mock.module('../../../../src/cli/commands/run/reporter-factory.js', () => ({
  createRunReporter: mock(() => ({
    onStart: mock(),
    onFinish: mock(),
    onEvent: mock(),
    onError: mock(),
  })),
}));

mock.module('../../../../src/cli/commands/run/loop-params.js', () => ({
  buildRunLoopParams: mock((params: Record<string, unknown>) => {
    hoisted.loopParamsCalls.push(params);
    return { applyBackOnDirty: '3way' };
  }),
}));

mock.module('../../../../src/cli/commands/run/execute.js', () => ({
  executeRunLoop: mock(async () => ({
    success: true,
    changedFiles: [],
    reasonCode: 'OK',
  })),
}));

mock.module('../../../../src/cli/commands/run/structured-output.js', () => ({
  buildStructuredOutputState: mock(async () => ({ ok: true, candidate: null })),
}));

mock.module('../../../../src/cli/commands/run/persist-session.js', () => ({
  persistRunSession: mock(async () => {}),
}));

mock.module('../../../../src/cli/commands/run/verbose.js', () => ({
  logRunVerboseSummary: mock(() => {}),
  resolveVerboseLevel: mock(() => 'basic'),
}));

mock.module('../../../../src/cli/commands/run/preflight.js', () => ({
  PreflightPolicy: { Auto: 'auto' },
  runPreflight: mock(async () => {}),
}));

mock.module('../../../../src/cli/commands/run/session.js', () => ({
  initializeSession: mock(async () => ({ sessionManager: undefined, sessionId: 'sess-1' })),
}));

mock.module('../../../../src/cli/commands/run/assistant-message.js', () => ({
  buildRunAssistantMessage: mock(() => 'ok'),
}));

mock.module('../../../../src/cli/commands/run/headless-error-writer.js', () => ({
  createHeadlessErrorWriter: mock(() => ({
    writeJsonFailure: mock(() => {}),
    writeResultExitCode: mock(() => 0),
    writeUnexpectedError: mock(() => {}),
    writeUsageError: mock(() => {}),
  })),
}));

mock.module('../../../../src/cli/headless/stdout-writer.js', () => ({
  createStdoutWriter: mock(() => ({ write: mock(() => {}) })),
}));

mock.module('../../../../src/core/runtime/exit-codes.js', () => ({
  getExitCode: mock(() => 0),
}));

describe('handleRunCommand outcome reporter', () => {
  it('uses shared outcome reporter helper', async () => {
    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');

    const command: any = { optsWithGlobals: () => ({}) };

    await handleRunCommand({}, command);

    expect(hoisted.reporterCalls.length).toBe(1);
    expect(hoisted.reporterCalls[0]).toEqual({
      enabled: true,
      endpoint: 'https://langfuse.example.test',
      llmBaseUrl: 'https://llm.example.test',
      llmApiKey: 'llm-key',
      proxyApiKeyEnv: process.env.SALMONLOOP_LANGFUSE_PROXY_API_KEY,
    });
    expect(hoisted.loopParamsCalls[0]?.auditScope).toBe('user');
  });
});
