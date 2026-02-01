import { z } from 'zod';

import { ToolSpec } from '../types.js';

/**
 * Configuration for an MCP server connection.
 */
export const McpServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * Extended ToolSpec for tools discovered via MCP.
 */
export interface McpToolSpec extends ToolSpec {
  isMcp: true;
  serverName: string;
}

/**
 * Response from an MCP tool execution.
 */
export interface McpExecutionResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
}
