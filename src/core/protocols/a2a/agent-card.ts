import type {
  AgentCard,
  AgentExtension,
  AgentProvider,
  AgentSkill,
  SecurityScheme,
} from '@a2a-js/sdk';

import { PACKAGE_VERSION } from '../../version.js';

interface CapabilityInput {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  security?: AgentSkill['security'];
}

type SecuritySchemeInput = SecurityScheme & { name?: string };

interface AgentCardCapabilityOptions {
  extensions?: AgentExtension[];
  pushNotifications?: boolean;
  streaming?: boolean;
  extendedAgentCard?: boolean;
}

export function buildA2AAgentCard(input: {
  name: string;
  url: string;
  capabilities?: CapabilityInput[];
  security: SecuritySchemeInput[];
  description?: string;
  documentationUrl?: string;
  provider?: AgentProvider;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  version?: string;
  protocolVersion?: string;
  capabilityOptions?: AgentCardCapabilityOptions;
}): AgentCard {
  const capabilities = input.capabilities ?? [];
  const protocolVersion = input.protocolVersion ?? '1.0';
  const agentCapabilities = {
    extensions: input.capabilityOptions?.extensions,
    pushNotifications: input.capabilityOptions?.pushNotifications ?? false,
    streaming: input.capabilityOptions?.streaming ?? true,
    ...(input.capabilityOptions?.extendedAgentCard === true ? { extendedAgentCard: true } : {}),
  };
  const securitySchemes =
    input.security.length > 0
      ? Object.fromEntries(
          input.security.map((scheme, index) => [
            scheme.name ?? `${scheme.type}-${index}`,
            toSecuritySchemeValue(scheme),
          ]),
        )
      : undefined;
  const securityRequirements =
    input.security.length > 0
      ? input.security.map(
          (scheme, index) =>
            ({ [scheme.name ?? `${scheme.type}-${index}`]: [] }) as Record<string, string[]>,
        )
      : undefined;
  return {
    name: input.name,
    description: input.description ?? 'Salmon Loop agent',
    version: input.version ?? PACKAGE_VERSION,
    documentationUrl: input.documentationUrl,
    provider: input.provider,
    supportedInterfaces: [
      {
        url: input.url,
        protocolBinding: 'JSONRPC',
        protocolVersion,
      },
    ],
    defaultInputModes: input.defaultInputModes ?? ['text/plain'],
    defaultOutputModes: input.defaultOutputModes ?? ['text/plain'],
    capabilities: agentCapabilities as AgentCard['capabilities'],
    skills: capabilities.map((capability) => ({
      id: capability.id,
      name: capability.title,
      description: capability.description ?? capability.title,
      tags: capability.tags ?? [],
      examples: capability.examples,
      inputModes: capability.inputModes,
      outputModes: capability.outputModes,
      securityRequirements: capability.security,
    })),
    securitySchemes,
    securityRequirements,
  } as unknown as AgentCard;
}

function toSecuritySchemeValue(scheme: SecuritySchemeInput): SecurityScheme {
  if (scheme.type === 'apiKey') {
    return { ...scheme };
  }

  const { name: _name, ...standardScheme } = scheme;
  return standardScheme;
}
