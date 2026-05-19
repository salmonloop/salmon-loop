import { beforeEach, describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  reporterCalls: [] as Array<Record<string, unknown>>,
  loopParamsCalls: [] as Array<Record<string, unknown>>,
  writeJsonFailureCalls: [] as Array<Record<string, unknown>>,
  writeUnexpectedErrorCalls: [] as Array<Record<string, unknown>>,
  resolvedConfigRaw: undefined as Record<string, unknown> | undefined,
  sessionManager: undefined as Record<string, unknown> | undefined,
  reporterImpl: {
    onStart: mock(),
    onFinish: mock(),
    onEvent: mock(),
    onError: mock(),
  },
  executeRunLoopImpl: mock(async (..._args: unknown[]) => ({
    success: true,
    changedFiles: [],
    reasonCode: 'OK',
  })),
  parsedOptions: {
    allOptions: {
      gui: false,
      validate: false,
      mode: 'interactive',
      verbose: false,
      dryRun: false,
      forceReset: false,
      file: undefined,
      selection: undefined,
      checkpointStrategy: 'worktree',
      outputFormat: 'text',
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
    allowedToolRules: [] as string[],
    disallowedToolRules: [] as string[],
  },
}))();

function resetHoistedState() {
  hoisted.reporterCalls.length = 0;
  hoisted.loopParamsCalls.length = 0;
  hoisted.writeJsonFailureCalls.length = 0;
  hoisted.writeUnexpectedErrorCalls.length = 0;
  hoisted.resolvedConfigRaw = undefined;
  hoisted.sessionManager = undefined;
  hoisted.reporterImpl = {
    onStart: mock(),
    onFinish: mock(),
    onEvent: mock(),
    onError: mock(),
  };
  hoisted.executeRunLoopImpl = mock(async (..._args: unknown[]) => ({
    success: true,
    changedFiles: [],
    reasonCode: 'OK',
  }));
  hoisted.parsedOptions = {
    allOptions: {
      gui: false,
      validate: false,
      mode: 'interactive',
      verbose: false,
      dryRun: false,
      forceReset: false,
      file: undefined,
      selection: undefined,
      checkpointStrategy: 'worktree',
      outputFormat: 'text',
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
    allowedToolRules: [] as string[],
    disallowedToolRules: [] as string[],
  };
}

mock.module('../../../../src/cli/utils/outcome-reporter.js', () => ({
  createOutcomeReporter: mock((params: Record<string, unknown>) => {
    hoisted.reporterCalls.push(params);
    return { type: 'outcome-reporter' };
  }),
}));

mock.module('../../../../src/cli/commands/run/parse-options.js', () => ({
  parseRunCommandOptions: mock(() => hoisted.parsedOptions),
}));

mock.module('../../../../src/cli/commands/run/early-errors.js', () => ({
  handleEarlyRunCommandErrors: mock(() => ({ ok: true })),
}));

mock.module('../../../../src/cli/commands/run/config-resolution.js', () => ({
  resolveRunConfig: mock(async () => ({
    ok: true,
    resolvedConfig: {
      repoPath: '/repo',
      outputFormat: 'text',
      headlessOutput: false,
      auditScope: 'user',
      resolvedConfig: {
        source: { used: false, path: undefined },
        raw: hoisted.resolvedConfigRaw,
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
        llm: { api: { baseUrl: 'https://llm.example.test', apiKey: 'llm-key' }, models: {} },
        permissionMode: 'interactive',
        llmOutput: { kinds: [] },
        markdownTheme: 'default',
        markdownRenderMode: 'enhanced',
        ui: { logView: 'summary', logMode: 'auto' },
        toolAuthorization: { allowlist: {} },
        astValidation: { strictness: 'strict' },
      },
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
  resolveRunMode: mock((raw: unknown) => {
    const value = String(raw || 'autopilot');
    if (
      value === 'patch' ||
      value === 'review' ||
      value === 'debug' ||
      value === 'research' ||
      value === 'answer' ||
      value === 'autopilot'
    ) {
      return value;
    }
    return undefined;
  }),
}));

mock.module('../../../../src/cli/commands/run/extensions-resolution.js', () => ({
  resolveRunExtensions: mock(async () => ({ ok: true, extensionResolution: { resolved: [] } })),
}));

mock.module('../../../../src/cli/commands/run/runtime-llm.js', () => ({
  createRuntimeLlmAndWarn: mock(() => ({ llm: { getModelId: () => undefined }, warnings: [] })),
}));

mock.module('../../../../src/cli/commands/run/reporter-factory.js', () => ({
  createRunReporter: mock(() => hoisted.reporterImpl),
}));

mock.module('../../../../src/cli/commands/run/loop-params.js', () => ({
  buildRunLoopParams: mock((params: Record<string, unknown>) => {
    hoisted.loopParamsCalls.push(params);
    return { applyBackOnDirty: '3way' };
  }),
}));

mock.module('../../../../src/cli/commands/run/execute.js', () => ({
  executeRunLoop: mock((...args: unknown[]) => hoisted.executeRunLoopImpl(...args)),
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
  initializeSession: mock(async () => ({
    sessionManager: hoisted.sessionManager,
    sessionId: 'sess-1',
  })),
}));

mock.module('../../../../src/cli/commands/run/assistant-message.js', () => ({
  buildRunAssistantMessage: mock(() => 'ok'),
}));

mock.module('../../../../src/cli/commands/run/headless-error-writer.js', () => ({
  createHeadlessErrorWriter: mock(() => ({
    writeJsonFailure: mock((args: Record<string, unknown>) => {
      hoisted.writeJsonFailureCalls.push(args);
    }),
    writeResultExitCode: mock(() => 0),
    writeUnexpectedError: mock((args: Record<string, unknown>) => {
      hoisted.writeUnexpectedErrorCalls.push(args);
    }),
    writeUsageError: mock(() => {}),
  })),
}));

mock.module('../../../../src/cli/headless/stdout-writer.js', () => ({
  createStdoutWriter: mock(() => ({ write: mock(() => {}) })),
}));

mock.module('../../../../src/core/runtime/exit-codes.js', () => ({
  getExitCode: mock(() => 0),
}));

mock.module('../../../../src/core/observability/logger.js', () => ({
  PlainReporter: class PlainReporter {
    log() {}
    clear() {}
  },
  SilentReporter: class SilentReporter {
    log() {}
    clear() {}
  },
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
  tryGetLogger: () => ({
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

describe('handleRunCommand outcome reporter', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    resetHoistedState();
    process.exitCode = 0;
  });

  it('uses shared outcome reporter helper', async () => {
    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');

    const command: any = { optsWithGlobals: () => ({}) };

    await handleRunCommand({}, command);

    expect(hoisted.reporterCalls.length).toBe(1);
    expect(hoisted.reporterCalls[0]).toEqual({
      enabled: true,
      endpoint: 'https://langfuse.example.test',
      llmBaseUrl: 'https://llm.example.test',
      langfuseApiKey: 'langfuse-key',
    });
    expect(hoisted.loopParamsCalls[0]?.auditScope).toBe('user');
  });

  it('keeps patch runs on worktree when only permission mode is yolo', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        mode: 'yolo',
        actMode: 'patch',
        checkpointStrategy: 'worktree',
      } as any,
    };
    hoisted.loopParamsCalls.length = 0;

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = {
      optsWithGlobals: () => ({}),
      getOptionValueSource: (name: string) =>
        name === 'mode' || name === 'actMode' ? 'cli' : 'default',
    };

    await handleRunCommand({}, command);

    expect(hoisted.loopParamsCalls[0]?.checkpointStrategy).toBe('worktree');
  });

  it('defaults autopilot runs to yolo permission mode and direct strategy when implicit', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        mode: 'interactive',
        actMode: 'autopilot',
        checkpointStrategy: 'worktree',
      } as any,
      allowedToolRules: ['Bash(ls *)'],
      disallowedToolRules: ['Bash(rm *)'],
    };
    hoisted.loopParamsCalls.length = 0;

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = {
      optsWithGlobals: () => ({}),
      getOptionValueSource: (name: string) =>
        name === 'mode' || name === 'checkpointStrategy' ? 'default' : 'cli',
    };

    await handleRunCommand({}, command);

    expect(hoisted.loopParamsCalls[0]?.mode).toBe('autopilot');
    expect(hoisted.loopParamsCalls[0]?.permissionMode).toBe('yolo');
    expect(hoisted.loopParamsCalls[0]?.checkpointStrategy).toBe('direct');
    expect(hoisted.loopParamsCalls[0]?.permissionRules).toEqual({
      allow: ['Bash(ls *)'],
      deny: ['Bash(rm *)'],
    });
  });

  it('does not let an unresolved config permission default override implicit autopilot permissions', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        mode: 'interactive',
        actMode: 'autopilot',
        checkpointStrategy: 'worktree',
      } as any,
    };
    hoisted.loopParamsCalls.length = 0;

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = {
      optsWithGlobals: () => ({}),
      getOptionValueSource: (name: string) =>
        name === 'mode' || name === 'checkpointStrategy' ? 'default' : 'cli',
    };

    await handleRunCommand({}, command);

    expect(hoisted.loopParamsCalls[0]?.mode).toBe('autopilot');
    expect(hoisted.loopParamsCalls[0]?.permissionMode).toBe('yolo');
  });

  it('honors an explicit config permission mode before the autopilot profile default', async () => {
    hoisted.resolvedConfigRaw = { version: 1, mode: 'interactive' };
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        mode: 'interactive',
        actMode: 'autopilot',
        checkpointStrategy: 'worktree',
      } as any,
    };
    hoisted.loopParamsCalls.length = 0;

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = {
      optsWithGlobals: () => ({}),
      getOptionValueSource: (name: string) =>
        name === 'mode' || name === 'checkpointStrategy' ? 'default' : 'cli',
    };

    await handleRunCommand({}, command);

    expect(hoisted.loopParamsCalls[0]?.mode).toBe('autopilot');
    expect(hoisted.loopParamsCalls[0]?.permissionMode).toBe('interactive');
  });

  it('honors global cli checkpoint strategy when option source lives on the parent command', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        mode: 'yolo',
        actMode: 'autopilot',
        checkpointStrategy: 'worktree',
      } as any,
    };
    hoisted.loopParamsCalls.length = 0;

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = {
      optsWithGlobals: () => ({}),
      getOptionValueSource: (name: string) => (name === 'actMode' ? 'cli' : undefined),
      parent: {
        getOptionValueSource: (name: string) =>
          name === 'mode' || name === 'checkpointStrategy' ? 'cli' : undefined,
      },
    };

    await handleRunCommand({}, command);

    expect(hoisted.loopParamsCalls[0]?.permissionMode).toBe('yolo');
    expect(hoisted.loopParamsCalls[0]?.checkpointStrategy).toBe('worktree');
  });

  it('defaults run to autopilot when --act-mode is omitted', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        mode: 'interactive',
        actMode: 'patch',
        checkpointStrategy: 'worktree',
      } as any,
    };
    hoisted.loopParamsCalls.length = 0;

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = {
      optsWithGlobals: () => ({}),
      getOptionValueSource: (name: string) =>
        name === 'actMode' || name === 'mode' || name === 'checkpointStrategy' ? 'default' : 'cli',
    };

    await handleRunCommand({}, command);

    expect(hoisted.loopParamsCalls[0]?.mode).toBe('autopilot');
    expect(hoisted.loopParamsCalls[0]?.permissionMode).toBe('yolo');
    expect(hoisted.loopParamsCalls[0]?.checkpointStrategy).toBe('direct');
  });

  it('preserves explicit cli permission rules even when permission mode is yolo', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        mode: 'yolo',
        actMode: 'patch',
      } as any,
      allowedToolRules: ['Bash(ls *)'],
      disallowedToolRules: ['Bash(rm *)'],
    };
    hoisted.loopParamsCalls.length = 0;

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = {
      optsWithGlobals: () => ({}),
      getOptionValueSource: (name: string) => (name === 'mode' ? 'cli' : 'default'),
    };

    await handleRunCommand({}, command);

    expect(hoisted.loopParamsCalls[0]?.permissionRules).toEqual({
      allow: ['Bash(ls *)'],
      deny: ['Bash(rm *)'],
    });
  });

  it('passes known auditPath to headless json failure when a late error happens after result creation', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      rawOutputFormat: 'json',
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        outputFormat: 'json',
      },
    };
    hoisted.writeJsonFailureCalls.length = 0;
    hoisted.writeUnexpectedErrorCalls.length = 0;
    hoisted.reporterImpl = {
      onStart: mock(),
      onFinish: mock(() => {
        throw new Error('reporter failed');
      }),
      onEvent: mock(),
      onError: mock(),
    };
    hoisted.executeRunLoopImpl = mock(async () => ({
      success: false,
      reason: 'Exceeded maximum retry attempts',
      reasonCode: 'MAX_RETRIES',
      changedFiles: [],
      auditPath: '/tmp/audit.json',
    }));

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = { optsWithGlobals: () => ({}) };

    try {
      await handleRunCommand({}, command);

      expect(hoisted.writeJsonFailureCalls.at(-1)).toMatchObject({
        instruction: 'fix bug',
        auditPath: '/tmp/audit.json',
      });
    } finally {
      process.exitCode = 0;
      hoisted.reporterImpl = {
        onStart: mock(),
        onFinish: mock(),
        onEvent: mock(),
        onError: mock(),
      };
      hoisted.executeRunLoopImpl = mock(async () => ({
        success: true,
        changedFiles: [],
        reasonCode: 'OK',
      }));
    }
  });

  it('passes known auditPath to native stream-json unexpected error before reporter start', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      rawOutputFormat: 'stream-json',
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        outputFormat: 'stream-json',
      },
    };
    hoisted.writeJsonFailureCalls.length = 0;
    hoisted.writeUnexpectedErrorCalls.length = 0;
    hoisted.reporterImpl = {
      onStart: mock(() => {
        throw new Error('reporter start failed');
      }),
      onFinish: mock(),
      onEvent: mock(),
      onError: mock(),
    };
    hoisted.executeRunLoopImpl = mock(async () => ({
      success: false,
      reason: 'Exceeded maximum retry attempts',
      reasonCode: 'MAX_RETRIES',
      changedFiles: [],
      auditPath: '/tmp/audit-stream.json',
    }));

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = { optsWithGlobals: () => ({}) };

    try {
      await handleRunCommand({}, command);

      expect(hoisted.writeUnexpectedErrorCalls.at(-1)).toMatchObject({
        message: expect.stringContaining('reporter start failed'),
      });
    } finally {
      process.exitCode = 0;
      hoisted.reporterImpl = {
        onStart: mock(),
        onFinish: mock(),
        onEvent: mock(),
        onError: mock(),
      };
      hoisted.executeRunLoopImpl = mock(async () => ({
        success: true,
        changedFiles: [],
        reasonCode: 'OK',
      }));
    }
  });

  it('does not reset native stream-json sequence state when a late error happens after start', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      rawOutputFormat: 'stream-json',
      allOptions: {
        ...hoisted.parsedOptions.allOptions,
        outputFormat: 'stream-json',
      },
    };
    hoisted.writeUnexpectedErrorCalls.length = 0;
    hoisted.reporterImpl = {
      onStart: mock(),
      onFinish: mock(() => {
        throw new Error('reporter failed');
      }),
      onEvent: mock(),
      onError: mock(),
    };
    hoisted.executeRunLoopImpl = mock(async () => ({
      success: false,
      reason: 'Exceeded maximum retry attempts',
      reasonCode: 'MAX_RETRIES',
      changedFiles: [],
      auditPath: '/tmp/audit-stream.json',
    }));

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = { optsWithGlobals: () => ({}) };

    try {
      await handleRunCommand({}, command);

      expect(hoisted.writeUnexpectedErrorCalls).toHaveLength(0);
      expect(hoisted.reporterImpl.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          auditPath: '/tmp/audit-stream.json',
          message: expect.stringContaining('reporter failed'),
        }),
      );
    } finally {
      process.exitCode = 0;
      hoisted.reporterImpl = {
        onStart: mock(),
        onFinish: mock(),
        onEvent: mock(),
        onError: mock(),
      };
      hoisted.executeRunLoopImpl = mock(async () => ({
        success: true,
        changedFiles: [],
        reasonCode: 'OK',
      }));
    }
  });

  it('uses canonical effective session context for continued runs', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      continueSession: true,
    };
    hoisted.loopParamsCalls.length = 0;
    hoisted.sessionManager = {
      getSummaryState: () => ({
        summary: 'summary body',
        summaryTokens: 8,
        summarizedMessageIds: ['m-0', 'm-1'],
        lastSummarizedAt: 100,
        summaryVersion: 2,
        contextHash: 'ctx-1',
        structuredState: {
          decisions: ['keep summary'],
          constraints: [],
          open_questions: [],
          pending_tasks: [],
          rejected_options: [],
          assumptions: [],
          risks: [],
          owner: [],
        },
      }),
      getMessages: () => [
        { id: 'm-0', role: 'user', content: 'old user', timestamp: 1 },
        { id: 'm-1', role: 'assistant', content: 'old assistant', timestamp: 2 },
        { id: 'm-2', role: 'user', content: 'recent user', timestamp: 3 },
      ],
      getMessagesWithIds: () => [
        { id: 'm-0', role: 'user', content: 'old user', timestamp: 1 },
        { id: 'm-1', role: 'assistant', content: 'old assistant', timestamp: 2 },
        { id: 'm-2', role: 'user', content: 'recent user', timestamp: 3 },
      ],
      getArtifactState: () => undefined,
      getReplacementState: () => undefined,
    };

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = { optsWithGlobals: () => ({}) };

    await handleRunCommand({}, command);

    expect(hoisted.loopParamsCalls[0]?.conversationContext).toEqual([
      expect.objectContaining({ role: 'system' }),
      {
        role: 'system',
        content: '[Previous conversation summary]\nsummary body',
      },
      {
        role: 'user',
        content: 'recent user',
      },
    ]);
  });

  it('forwards restored session artifact hints into loop params for continued runs', async () => {
    hoisted.parsedOptions = {
      ...hoisted.parsedOptions,
      continueSession: true,
    };
    hoisted.loopParamsCalls.length = 0;
    hoisted.sessionManager = {
      getSummaryState: () => undefined,
      getMessages: () => [],
      getMessagesWithIds: () => [],
      getArtifactState: () => ({
        verifyArtifact: {
          handle: 's8p://artifact/verify-restored',
          mimeType: 'text/plain',
          sha256: 'verify-restored',
          size: 123,
        },
        recentReadArtifacts: [
          {
            path: 'src/restored.ts',
            artifact: {
              handle: 's8p://artifact/read-restored',
              mimeType: 'text/plain',
              sha256: 'read-restored',
              size: 45,
            },
          },
        ],
      }),
      getReplacementState: () => undefined,
    };

    const { handleRunCommand } = await import('../../../../src/cli/commands/run/handler.js');
    const command: any = { optsWithGlobals: () => ({}) };

    await handleRunCommand({}, command);

    expect(hoisted.loopParamsCalls[0]?.artifactHints).toEqual(
      expect.objectContaining({
        verifyArtifact: expect.objectContaining({
          handle: 's8p://artifact/verify-restored',
        }),
        recentReadArtifacts: [
          expect.objectContaining({
            path: 'src/restored.ts',
            artifact: expect.objectContaining({
              handle: 's8p://artifact/read-restored',
            }),
          }),
        ],
      }),
    );
  });
});
