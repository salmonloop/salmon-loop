import { describe, expect, test } from 'bun:test';

import { buildA2AAgentCard } from '../../../../../src/core/protocols/a2a/agent-card.ts';
import { buildA2AFlowSkills } from '../../../../../src/core/protocols/shared/flow-mode-mapping.ts';

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

  test('defaults to flow-backed skills including autopilot', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com',
      security: [],
    });

    expect(card.skills.map((skill) => skill.id)).toEqual(buildA2AFlowSkills().map((skill) => skill.id));
    expect(card.skills.some((skill) => skill.id === 'autopilot')).toBe(true);
    expect(card.skills.find((skill) => skill.id === 'autopilot')).toMatchObject({
      name: 'Autopilot',
      description: 'Let the agent decide which actions and tools to use.',
    });
  });
});
