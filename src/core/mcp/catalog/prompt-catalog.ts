import type { McpPromptDescriptor } from '../types.js';

export function withPromptServer(
  serverName: string,
  prompts: Array<Record<string, unknown>>,
): McpPromptDescriptor[] {
  return prompts.map((prompt) => ({ ...(prompt as any), serverName }) as McpPromptDescriptor);
}
