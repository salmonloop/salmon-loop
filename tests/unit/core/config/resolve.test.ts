import { beforeEach, describe, expect, it, mock } from 'bun:test';

const tryLoadConfigFileMock = mock();

mock.module('../../../../src/core/config/load.js', () => ({
  tryLoadConfigFile: tryLoadConfigFileMock,
}));

import { resolveConfig } from '../../../../src/core/config/resolve.js';

describe('resolveConfig (security/observability)', () => {
  beforeEach(() => {
    tryLoadConfigFileMock.mockReset();
  });

  it('uses defaults when config is missing', async () => {
    tryLoadConfigFileMock.mockResolvedValue(undefined);
    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.security.redaction.enabled).toBe(true);
    expect(resolved.observability.audit.buffer.maxEvents).toBeGreaterThan(0);
    expect(resolved.observability.audit.buffer.maxBytes).toBeGreaterThan(0);
  });

  it('applies configured redaction and audit buffer limits', async () => {
    tryLoadConfigFileMock.mockResolvedValue({
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
        observability: { audit: { buffer: { maxEvents: 5, maxBytes: 2048, droppedWarn: 100 } } },
      },
      path: '/repo/.salmonloop/config.json',
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
    tryLoadConfigFileMock.mockResolvedValue({
      config: {
        server: {
          a2a: { host: '0.0.0.0', port: 7447, tokens: ['secret'] },
          sidecar: { socket: '/tmp/agent-message.sock', allowConditional: true },
        },
      },
      path: '/repo/.salmonloop/config.json',
    });

    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.server?.a2a?.host).toBe('0.0.0.0');
    expect(resolved.server?.a2a?.port).toBe(7447);
    expect(resolved.server?.a2a?.tokens).toEqual(['secret']);
    expect(resolved.server?.sidecar?.socket).toBe('/tmp/agent-message.sock');
    expect(resolved.server?.sidecar?.allowConditional).toBe(true);
  });
});
