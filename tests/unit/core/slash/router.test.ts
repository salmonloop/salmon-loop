import { describe, expect, it } from 'bun:test';

import { createSlashRegistry } from '../../../../src/core/slash/registry.js';
import { SlashRouter } from '../../../../src/core/slash/router.js';

describe('SlashRouter', () => {
  it('forwards non-slash input', async () => {
    const registry = createSlashRegistry({ commands: [] });
    const router = new SlashRouter({
      registry,
      handlers: { getHandler: () => undefined },
      unknownSlashPolicy: 'block',
    });

    const decision = await router.dispatch('Hello world');
    expect(decision).toEqual({ kind: 'forward', input: 'Hello world' });
  });

  it('blocks unknown slash by default', async () => {
    const registry = createSlashRegistry({ commands: [] });
    const router = new SlashRouter({
      registry,
      handlers: { getHandler: () => undefined },
      unknownSlashPolicy: 'block',
    });

    const decision = await router.dispatch('/nope arg');
    expect(decision.kind).toBe('block');
    expect((decision as any).code).toBe('UNKNOWN_SLASH');
  });
});
