interface CapabilityInput {
  id: string;
  title: string;
}

interface SecuritySchemeInput {
  type: string;
  scheme: string;
}

export function buildA2AAgentCard(input: {
  name: string;
  url: string;
  capabilities: CapabilityInput[];
  security: SecuritySchemeInput[];
}) {
  return {
    name: input.name,
    url: input.url,
    skills: input.capabilities.map((capability) => ({
      id: capability.id,
      name: capability.title,
    })),
    securitySchemes: input.security,
  };
}
