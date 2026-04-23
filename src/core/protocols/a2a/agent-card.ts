import type { AgentCard, SecurityScheme } from '@a2a-js/sdk';

import { buildA2AFlowSkills } from '../shared/flow-mode-mapping.js';

interface CapabilityInput {
  id: string;
  title: string;
}

type SecuritySchemeInput = SecurityScheme & { name?: string };

interface AgentCardCapabilityOptions {
  pushNotifications?: boolean;
  streaming?: boolean;
  stateTransitionHistory?: boolean;
}

export function buildA2AAgentCard(input: {
  name: string;
  url: string;
  capabilities?: CapabilityInput[];
  security: SecuritySchemeInput[];
  description?: string;
  version?: string;
  protocolVersion?: string;
  capabilityOptions?: AgentCardCapabilityOptions;
}): AgentCard {
  const capabilities = input.capabilities ?? buildA2AFlowSkills();
  const securitySchemes =
    input.security.length > 0
      ? Object.fromEntries(
          input.security.map((scheme, index) => [
            scheme.name ?? `${scheme.type}-${index}`,
            { ...scheme },
          ]),
        )
      : undefined;
  return {
    name: input.name,
    url: input.url,
    description: input.description ?? 'Salmon Loop agent',
    version: input.version ?? '0.2.0',
    protocolVersion: input.protocolVersion ?? '1.0.0',
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    capabilities: {
      pushNotifications: input.capabilityOptions?.pushNotifications ?? false,
      streaming: input.capabilityOptions?.streaming ?? true,
      stateTransitionHistory: input.capabilityOptions?.stateTransitionHistory ?? true,
    },
    skills: capabilities.map((capability) => ({
      id: capability.id,
      name: capability.title,
      description: capability.title,
      tags: [],
    })),
    securitySchemes,
  };
}
