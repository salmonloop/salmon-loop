import { describe, expect, test } from 'bun:test';

import { buildA2AAgentCard } from '../../../../../src/core/protocols/a2a/agent-card.ts';

describe('A2A agent card', () => {
  test('declares bearer auth and projected capabilities', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com',
      capabilities: [
        {
          id: 'patch',
          title: 'Patch code',
          description: 'Apply code changes with verification.',
        },
      ],
      security: [{ type: 'http', scheme: 'bearer' }],
    });

    expect(card.name).toBe('salmon-loop');
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0]).toMatchObject({
      id: 'patch',
      name: 'Patch code',
      description: 'Apply code changes with verification.',
    });
    const securityValues = card.securitySchemes ? Object.values(card.securitySchemes) : [];
    expect(securityValues).toContainEqual({ type: 'http', scheme: 'bearer' });
  });

  test('requires explicit capabilities instead of defaulting to all flow-backed skills', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com',
      security: [],
    });

    expect(card.skills).toEqual([]);
  });
});
