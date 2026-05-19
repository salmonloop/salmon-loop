import type { McpResourceDescriptor, McpResourceTemplateDescriptor } from '../types.js';

export function withResourceServer(
  serverName: string,
  resources: Array<Record<string, unknown>>,
): McpResourceDescriptor[] {
  return resources.map(
    (resource) => ({ ...(resource as any), serverName }) as McpResourceDescriptor,
  );
}

export function withResourceTemplateServer(
  serverName: string,
  templates: Array<Record<string, unknown>>,
): McpResourceTemplateDescriptor[] {
  return templates.map(
    (template) => ({ ...(template as any), serverName }) as McpResourceTemplateDescriptor,
  );
}
