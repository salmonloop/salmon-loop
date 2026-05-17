import { describe, expect, it } from 'bun:test';

import { validateConfigFileV1 } from '../../../../src/core/config/validate.js';

describe('validateConfigFileV1 (context.cache)', () => {
  it('accepts persistent cache with path and allowedRoots', () => {
    const parsed = validateConfigFileV1({
      context: {
        cache: {
          mode: 'persistent',
          path: '.salmonloop/cache/context-cache.json',
          allowedRoots: ['.salmonloop/cache'],
        },
      },
    });

    expect(parsed.context?.cache?.mode).toBe('persistent');
    expect(parsed.context?.cache?.allowedRoots).toEqual(['.salmonloop/cache']);
  });

  it('rejects persistent cache without allowedRoots', () => {
    expect(() =>
      validateConfigFileV1({
        context: {
          cache: {
            mode: 'persistent',
            path: '.salmonloop/cache/context-cache.json',
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_CONTEXT_CACHE_ALLOWED_ROOTS/);
  });

  it('accepts cache maxPayloadBytes', () => {
    const parsed = validateConfigFileV1({
      context: {
        cache: {
          maxPayloadBytes: 1024,
        },
      },
    });

    expect(parsed.context?.cache?.maxPayloadBytes).toBe(1024);
  });

  it('rejects invalid cache maxPayloadBytes', () => {
    expect(() =>
      validateConfigFileV1({
        context: {
          cache: {
            maxPayloadBytes: 'nope',
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_CONTEXT_CACHE_MAX_PAYLOAD/);
  });
});

describe('validateConfigFileV1 (audit buffer)', () => {
  it('accepts audit buffer limits', () => {
    const parsed = validateConfigFileV1({
      observability: {
        audit: {
          buffer: {
            maxEvents: 100,
            maxBytes: 1024,
          },
        },
      },
    });

    expect(parsed.observability?.audit?.buffer?.maxEvents).toBe(100);
    expect(parsed.observability?.audit?.buffer?.maxBytes).toBe(1024);
  });

  it('rejects invalid audit buffer limits', () => {
    expect(() =>
      validateConfigFileV1({
        observability: {
          audit: {
            buffer: {
              maxEvents: 'nope',
            },
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_OBSERVABILITY_AUDIT_MAX_EVENTS/);
  });

  it('accepts audit buffer warn threshold', () => {
    const parsed = validateConfigFileV1({
      observability: {
        audit: {
          buffer: {
            droppedWarn: 200,
          },
        },
      },
    });

    expect(parsed.observability?.audit?.buffer?.droppedWarn).toBe(200);
  });

  it('rejects invalid audit buffer warn threshold', () => {
    expect(() =>
      validateConfigFileV1({
        observability: {
          audit: {
            buffer: {
              droppedWarn: 'nope',
            },
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_OBSERVABILITY_AUDIT_DROPPED_WARN/);
  });

  it('accepts audit scope user', () => {
    const parsed = validateConfigFileV1({
      observability: {
        audit: {
          scope: 'user',
        },
      },
    });

    expect(parsed.observability?.audit?.scope).toBe('user');
  });

  it('rejects invalid audit scope', () => {
    expect(() =>
      validateConfigFileV1({
        observability: {
          audit: {
            scope: 'invalid',
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_OBSERVABILITY_AUDIT_SCOPE/);
  });
});

describe('validateConfigFileV1 (security.redaction)', () => {
  it('accepts redaction settings', () => {
    const parsed = validateConfigFileV1({
      security: {
        redaction: {
          enabled: false,
          mark: '[MASKED]',
          maxDepth: 2,
        },
      },
    });

    expect(parsed.security?.redaction?.enabled).toBe(false);
    expect(parsed.security?.redaction?.mark).toBe('[MASKED]');
    expect(parsed.security?.redaction?.maxDepth).toBe(2);
  });

  it('rejects invalid redaction settings', () => {
    expect(() =>
      validateConfigFileV1({
        security: {
          redaction: {
            enabled: 'nope',
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_SECURITY_REDACTION_ENABLED/);
  });

  it('accepts redaction allow/deny lists and patterns', () => {
    const parsed = validateConfigFileV1({
      security: {
        redaction: {
          keyAllowlist: ['safe_key'],
          keyDenylist: ['secret_key'],
          patterns: ['secret-[a-z]+'],
          disableDefaults: true,
        },
      },
    });

    expect(parsed.security?.redaction?.keyAllowlist).toEqual(['safe_key']);
    expect(parsed.security?.redaction?.keyDenylist).toEqual(['secret_key']);
    expect(parsed.security?.redaction?.patterns).toEqual(['secret-[a-z]+']);
    expect(parsed.security?.redaction?.disableDefaults).toBe(true);
  });

  it('rejects invalid redaction lists and patterns', () => {
    expect(() =>
      validateConfigFileV1({
        security: {
          redaction: {
            keyAllowlist: 'nope',
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_SECURITY_REDACTION_KEY_ALLOWLIST/);
  });
});

describe('validateConfigFileV1 (server)', () => {
  it('accepts A2A and ACP server settings', () => {
    const parsed = validateConfigFileV1({
      server: {
        a2a: {
          host: '0.0.0.0',
          port: 7447,
          tokens: ['token-a', 'token-b'],
        },
        acp: {
          sessionStore: {
            maxEntries: 300,
            maxAgeMs: 1209600000,
            historyMaxEntries: 80,
            lockStaleMs: 45000,
            lockHeartbeatMs: 3000,
          },
          checkpointManifest: {
            lockStaleMs: 42000,
            lockHeartbeatMs: 2500,
          },
        },
      },
    });

    expect(parsed.server?.a2a?.host).toBe('0.0.0.0');
    expect(parsed.server?.a2a?.port).toBe(7447);
    expect(parsed.server?.a2a?.tokens).toEqual(['token-a', 'token-b']);
    expect(parsed.server?.acp?.sessionStore?.maxEntries).toBe(300);
    expect(parsed.server?.acp?.checkpointManifest?.lockStaleMs).toBe(42000);
  });

  it('rejects retired sidecar server config', () => {
    expect(() =>
      validateConfigFileV1({
        server: {
          sidecar: {
            socket: '/tmp/agent-message.sock',
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_SERVER_UNKNOWN_KEY/);
  });

  it('rejects invalid server config', () => {
    expect(() =>
      validateConfigFileV1({
        server: {
          a2a: {
            port: 'nope',
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_SERVER_A2A_PORT/);
  });

  it('rejects invalid ACP session store config', () => {
    expect(() =>
      validateConfigFileV1({
        server: {
          acp: {
            sessionStore: {
              maxEntries: 'bad',
            },
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_SERVER_ACP_SESSION_STORE_MAX_ENTRIES/);
  });

  it('rejects invalid ACP checkpoint manifest config', () => {
    expect(() =>
      validateConfigFileV1({
        server: {
          acp: {
            checkpointManifest: {
              lockHeartbeatMs: 'bad',
            },
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_SERVER_ACP_CHECKPOINT_MANIFEST_LOCK_HEARTBEAT_MS/);
  });
});

describe('validateConfigFileV1 (llm capabilities)', () => {
  it('accepts provider and model capabilities', () => {
    const parsed = validateConfigFileV1({
      llm: {
        activeModel: 'default',
        providers: {
          openaiMain: {
            type: 'openai-compatible',
            capabilities: {
              toolCalling: false,
              responseFormatJsonObject: true,
              streaming: false,
            },
          },
        },
        models: {
          default: {
            provider: 'openaiMain',
            id: 'gpt-test',
            capabilities: {
              toolCalling: true,
            },
          },
        },
      },
    });

    expect(parsed.llm?.providers?.openaiMain.capabilities).toEqual({
      toolCalling: false,
      responseFormatJsonObject: true,
      streaming: false,
    });
    expect(parsed.llm?.models?.default.capabilities).toEqual({
      toolCalling: true,
    });
  });

  it('rejects capability keys flattened directly under params', () => {
    expect(() =>
      validateConfigFileV1({
        llm: {
          activeModel: 'default',
          providers: {
            openaiMain: {
              type: 'openai-compatible',
            },
          },
          models: {
            default: {
              provider: 'openaiMain',
              id: 'gpt-test',
              params: {
                temperature: 0,
                toolCalling: false,
              },
            },
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_LLM_CAPABILITY_LOCATION/);
  });

  it('rejects capabilities nested under params', () => {
    expect(() =>
      validateConfigFileV1({
        llm: {
          activeModel: 'default',
          providers: {
            openaiMain: {
              type: 'openai-compatible',
            },
          },
          models: {
            default: {
              provider: 'openaiMain',
              id: 'gpt-test',
              params: {
                temperature: 0,
                capabilities: {
                  toolCalling: false,
                },
              },
            },
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_LLM_CAPABILITY_LOCATION/);
  });

  it('rejects non-boolean capability values', () => {
    expect(() =>
      validateConfigFileV1({
        llm: {
          activeModel: 'default',
          providers: {
            openaiMain: {
              type: 'openai-compatible',
              capabilities: {
                toolCalling: 'nope',
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
      }),
    ).toThrow(/CONFIG_INVALID_LLM_CAPABILITY/);
  });

  it('rejects unknown capability names', () => {
    expect(() =>
      validateConfigFileV1({
        llm: {
          activeModel: 'default',
          providers: {
            openaiMain: {
              type: 'openai-compatible',
              capabilities: {
                tools: false,
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
      }),
    ).toThrow(/CONFIG_INVALID_LLM_CAPABILITY/);
  });
});

describe('validateConfigFileV1 (output.llm)', () => {
  it('accepts research output kind', () => {
    const parsed = validateConfigFileV1({
      output: {
        llm: {
          kinds: ['research'],
        },
      },
    });

    expect(parsed.output?.llm?.kinds).toEqual(['research']);
  });

  it('rejects invalid output kinds', () => {
    expect(() =>
      validateConfigFileV1({
        output: {
          llm: {
            kinds: ['nope'],
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_LLM_OUTPUT_KIND/);
  });
});

describe('validateConfigFileV1 (permission mode)', () => {
  it('accepts interactive permission mode', () => {
    const parsed = validateConfigFileV1({
      mode: 'interactive',
    });

    expect(parsed.mode).toBe('interactive');
  });

  it('accepts yolo permission mode', () => {
    const parsed = validateConfigFileV1({
      mode: 'yolo',
    });

    expect(parsed.mode).toBe('yolo');
  });

  it('rejects invalid permission mode', () => {
    expect(() =>
      validateConfigFileV1({
        mode: 'fast',
      }),
    ).toThrow(/CONFIG_INVALID_MODE/);
  });
});
