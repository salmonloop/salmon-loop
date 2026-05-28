import { describe, expect, test } from 'bun:test';

import { buildA2AAgentCard } from '../../../../../src/core/protocols/a2a/agent-card.ts';
import { PACKAGE_VERSION } from '../../../../../src/core/version.ts';

describe('A2A agent card', () => {
  test('declares bearer auth and projected capabilities', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com/a2a/jsonrpc',
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
    expect(card.version).toBe(PACKAGE_VERSION);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0]).toMatchObject({
      id: 'patch',
      name: 'Patch code',
      description: 'Apply code changes with verification.',
    });
    expect((card as unknown as { url?: string }).url).toBeUndefined();
    expect((card as unknown as { protocolVersion?: string }).protocolVersion).toBeUndefined();
    expect((card as unknown as { preferredTransport?: string }).preferredTransport).toBeUndefined();
    expect(
      (card as unknown as { additionalInterfaces?: Array<{ transport: string; url: string }> })
        .additionalInterfaces,
    ).toBeUndefined();
    expect(
      (
        card as unknown as {
          supportedInterfaces?: Array<{
            url: string;
            protocolBinding: string;
            protocolVersion: string;
          }>;
        }
      ).supportedInterfaces,
    ).toEqual([
      {
        url: 'https://example.com/a2a/jsonrpc',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ]);
    const securityValues = card.securitySchemes ? Object.values(card.securitySchemes) : [];
    expect(securityValues).toContainEqual({ type: 'http', scheme: 'bearer' });
  });

  test('requires explicit capabilities instead of defaulting to all flow-backed skills', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com/a2a/jsonrpc',
      security: [],
    });

    expect(card.skills).toEqual([]);
  });

  test('passes standard capability extensions, default modes, and skill security requirements', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com/a2a/jsonrpc',
      documentationUrl: 'https://docs.example.com/salmon-loop',
      provider: {
        organization: 'Salmon Loop',
        url: 'https://example.com',
      },
      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['text/plain', 'application/json'],
      capabilityOptions: {
        extensions: [
          {
            uri: 'https://example.com/a2a/extensions/review-context',
            description: 'Provides repository review context.',
            required: false,
            params: { version: 1 },
          },
        ],
      },
      capabilities: [
        {
          id: 'review',
          title: 'Review code',
          description: 'Review code changes.',
          security: [{ bearer: [] }],
        },
      ],
      security: [{ name: 'bearer', type: 'http', scheme: 'bearer' }],
    });

    expect(card.defaultInputModes).toEqual(['text/plain', 'application/json']);
    expect(card.defaultOutputModes).toEqual(['text/plain', 'application/json']);
    expect((card as unknown as { documentationUrl?: string }).documentationUrl).toBe(
      'https://docs.example.com/salmon-loop',
    );
    expect(
      (card as unknown as { provider?: { organization: string; url: string } }).provider,
    ).toEqual({
      organization: 'Salmon Loop',
      url: 'https://example.com',
    });
    expect(card.capabilities.extensions).toEqual([
      {
        uri: 'https://example.com/a2a/extensions/review-context',
        description: 'Provides repository review context.',
        required: false,
        params: { version: 1 },
      },
    ]);
    expect(card.securitySchemes?.bearer).toEqual({ type: 'http', scheme: 'bearer' });
    expect(
      (card as unknown as { securityRequirements?: Array<Record<string, string[]>> })
        .securityRequirements,
    ).toEqual([{ bearer: [] }]);
    expect(
      (card as unknown as { security?: Array<Record<string, string[]>> }).security,
    ).toBeUndefined();
    expect(
      (
        card.skills[0] as (typeof card.skills)[number] & {
          securityRequirements?: Array<Record<string, string[]>>;
          security?: Array<Record<string, string[]>>;
        }
      ).securityRequirements,
    ).toEqual([{ bearer: [] }]);
    expect(
      (
        card.skills[0] as (typeof card.skills)[number] & {
          securityRequirements?: Array<Record<string, string[]>>;
          security?: Array<Record<string, string[]>>;
        }
      ).security,
    ).toBeUndefined();
  });

  test('declares authenticated extended agent card support via capabilities object', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com/a2a/jsonrpc',
      capabilityOptions: {
        extendedAgentCard: true,
      },
      security: [],
    });

    expect((card.capabilities as Record<string, unknown>).extendedAgentCard).toBe(true);
    expect(
      (card as unknown as { supportsAuthenticatedExtendedCard?: boolean })
        .supportsAuthenticatedExtendedCard,
    ).toBeUndefined();
  });

  test('does not expose legacy stateTransitionHistory in A2A 1.0 capabilities', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com/a2a/jsonrpc',
      security: [],
    });

    expect((card.capabilities as Record<string, unknown>).stateTransitionHistory).toBeUndefined();
  });

  test('keeps apiKey parameter name while omitting helper names from non-apiKey security schemes', () => {
    const card = buildA2AAgentCard({
      name: 'salmon-loop',
      url: 'https://example.com/a2a/jsonrpc',
      security: [
        { name: 'bearerAuth', type: 'http', scheme: 'bearer' },
        { name: 'apiKeyAuth', type: 'apiKey', in: 'header' },
      ],
    });

    expect(
      (card as unknown as { securityRequirements?: Array<Record<string, string[]>> })
        .securityRequirements,
    ).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
    expect(
      (card as unknown as { security?: Array<Record<string, string[]>> }).security,
    ).toBeUndefined();
    expect(card.securitySchemes?.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' });
    expect(card.securitySchemes?.apiKeyAuth).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'apiKeyAuth',
    });
  });
});
