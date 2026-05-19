import type { McpToolDescriptor } from '../types.js';

export function withToolServer(
  serverName: string,
  tools: Array<Record<string, unknown>>,
): McpToolDescriptor[] {
  return tools.map((tool) => ({ ...(tool as any), serverName }) as McpToolDescriptor);
}
