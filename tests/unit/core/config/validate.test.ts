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
});
