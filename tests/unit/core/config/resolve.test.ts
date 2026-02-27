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
        security: { redaction: { enabled: false, mark: '[MASKED]', maxDepth: 3 } },
        observability: { audit: { buffer: { maxEvents: 5, maxBytes: 2048 } } },
      },
      path: '/repo/.salmonloop/config.json',
    });

    const resolved = await resolveConfig({ repoRoot: '/repo' });

    expect(resolved.security.redaction.enabled).toBe(false);
    expect(resolved.security.redaction.mark).toBe('[MASKED]');
    expect(resolved.security.redaction.maxDepth).toBe(3);
    expect(resolved.observability.audit.buffer.maxEvents).toBe(5);
    expect(resolved.observability.audit.buffer.maxBytes).toBe(2048);
  });
});
