import { describe, expect, test } from 'bun:test';

import { buildA2AAgentCard } from '../../../../../src/core/protocols/a2a/agent-card.js';

describe('A2A agent card', () => {
  test('declares bearer auth and projected capabilities', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com',
      capabilities: [{ id: 'patch', title: 'Patch code' }],
      security: [{ type: 'http', scheme: 'bearer' }],
    });

    expect(card.name).toBe('salmon-loop');
    expect(card.skills).toHaveLength(1);
    expect(card.securitySchemes).toEqual([{ type: 'http', scheme: 'bearer' }]);
  });
});
