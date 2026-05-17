import { beforeEach, describe, expect, it, mock } from 'bun:test';

const loadConfigStackMock = mock();

mock.module('../../../../src/core/config/load.js', () => ({
  loadConfigStack: loadConfigStackMock,
}));

import { resolveConfig } from '../../../../src/core/config/resolve.js';

describe('resolveConfig (security/observability)', () => {
  beforeEach(() => {
    loadConfigStackMock.mockReset();
  });

  it('uses defaults when config is missing', async () => {
    loadConfigStackMock.mockResolvedValue({});
    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.security.redaction.enabled).toBe(true);
    expect(resolved.observability.audit.buffer.maxEvents).toBeGreaterThan(0);
    expect(resolved.observability.audit.buffer.maxBytes).toBeGreaterThan(0);
  });

  it('applies configured redaction and audit buffer limits', async () => {
    loadConfigStackMock.mockResolvedValue({
      repo: {
        config: {
          security: {
            redaction: {
              enabled: false,
              mark: '[MASKED]',
              maxDepth: 3,
              keyAllowlist: ['safe_key'],
              keyDenylist: ['secret_key'],
              patterns: ['secret-[a-z]+'],
              disableDefaults: true,
            },
          },
          observability: {
            audit: { buffer: { maxEvents: 5, maxBytes: 2048, droppedWarn: 100 } },
          },
        },
        path: '/repo/.salmonloop/config.json',
      },
    });

    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.security.redaction.enabled).toBe(false);
    expect(resolved.security.redaction.mark).toBe('[MASKED]');
    expect(resolved.security.redaction.maxDepth).toBe(3);
    expect(resolved.security.redaction.keyAllowlist).toEqual(['safe_key']);
    expect(resolved.security.redaction.keyDenylist).toEqual(['secret_key']);
    expect(resolved.security.redaction.patterns).toEqual(['secret-[a-z]+']);
    expect(resolved.security.redaction.disableDefaults).toBe(true);
    expect(resolved.observability.audit.buffer.maxEvents).toBe(5);
    expect(resolved.observability.audit.buffer.maxBytes).toBe(2048);
    expect(resolved.observability.audit.buffer.droppedWarn).toBe(100);
  });

  it('resolves server config when provided', async () => {
    loadConfigStackMock.mockResolvedValue({
      repo: {
        config: {
          server: {
            a2a: { host: '0.0.0.0', port: 7447, tokens: ['secret'] },
            acp: {
              sessionStore: {
                maxEntries: 256,
                maxAgeMs: 1000 * 60 * 60,
                historyMaxEntries: 32,
                lockStaleMs: 40000,
                lockHeartbeatMs: 2000,
              },
              checkpointManifest: {
                lockStaleMs: 42000,
                lockHeartbeatMs: 2500,
              },
            },
          },
        },
        path: '/repo/.salmonloop/config.json',
      },
    });

    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.server?.a2a?.host).toBe('0.0.0.0');
    expect(resolved.server?.a2a?.port).toBe(7447);
    expect(resolved.server?.a2a?.tokens).toEqual(['secret']);
    expect(resolved.server?.acp?.sessionStore?.maxEntries).toBe(256);
    expect(resolved.server?.acp?.sessionStore?.lockHeartbeatMs).toBe(2000);
    expect(resolved.server?.acp?.checkpointManifest?.lockStaleMs).toBe(42000);
    expect(resolved.server?.acp?.checkpointManifest?.lockHeartbeatMs).toBe(2500);
  });

  it('does not resolve retired sidecar server config', async () => {
    loadConfigStackMock.mockResolvedValue({
      repo: {
        config: {
          server: {
            sidecar: { socket: '/tmp/agent-message.sock', allowConditional: true },
          },
        },
        path: '/repo/.salmonloop/config.json',
      },
    });

    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.server).toBeUndefined();
  });

  it('uses interactive as default permission mode', async () => {
    loadConfigStackMock.mockResolvedValue({});
    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.permissionMode).toBe('interactive');
  });

  it('resolves permission mode from config', async () => {
    loadConfigStackMock.mockResolvedValue({
      repo: {
        config: {
          mode: 'yolo',
        },
        path: '/repo/.salmonloop/config.json',
      },
    });

    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.permissionMode).toBe('yolo');
  });

  it('merges user config with repo overrides', async () => {
    loadConfigStackMock.mockResolvedValue({
      user: {
        config: {
          mode: 'interactive',
          observability: { audit: { scope: 'user' } },
        },
        path: '/user/.salmonloop/config.json',
      },
      repo: {
        config: {
          mode: 'yolo',
          observability: { audit: { buffer: { maxEvents: 10 } } },
        },
        path: '/repo/.salmonloop/config.json',
      },
    });

    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.permissionMode).toBe('yolo');
    expect(resolved.observability.audit.scope).toBe('user');
    expect(resolved.observability.audit.buffer.maxEvents).toBe(10);
    expect(resolved.source.path).toBe('/repo/.salmonloop/config.json');
  });

  it('resolves provider/model llm capability overrides with model priority', async () => {
    loadConfigStackMock.mockResolvedValue({
      repo: {
        config: {
          llm: {
            activeModel: 'default',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                api: { baseUrl: 'https://example.com/v1', apiKey: 'inline-key' },
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
                id: 'gpt-default',
                capabilities: {
                  toolCalling: true,
                },
              },
            },
          },
        },
        path: '/repo/.salmonloop/config.json',
      },
    });

    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.llm.capabilities).toEqual({
      toolCalling: true,
      responseFormatJsonObject: true,
      streaming: false,
    });
  });

  it('resolves phase llm capability overrides independently', async () => {
    loadConfigStackMock.mockResolvedValue({
      repo: {
        config: {
          llm: {
            activeModel: 'default',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                api: { baseUrl: 'https://example.com/v1', apiKey: 'inline-key' },
                capabilities: {
                  toolCalling: false,
                  streaming: false,
                },
              },
            },
            models: {
              default: {
                provider: 'openaiMain',
                id: 'gpt-default',
              },
              planModel: {
                provider: 'openaiMain',
                id: 'gpt-plan',
                capabilities: {
                  toolCalling: true,
                },
              },
            },
            routing: {
              phaseToModel: {
                PLAN: 'planModel',
              },
            },
          },
        },
        path: '/repo/.salmonloop/config.json',
      },
    });

    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.llm.capabilities).toEqual({
      toolCalling: false,
      streaming: false,
    });
    expect(resolved.llm.routing?.phaseToProviderModel?.PLAN?.capabilities).toEqual({
      toolCalling: true,
      streaming: false,
    });
  });
});
