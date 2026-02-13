import { z } from 'zod';

import { ToolSpec } from '../types.js';

/**
 * Configuration for an MCP server connection.
 */
export const McpServerConfigSchema = z
  .object({
    name: z.string(),
    command: z.string().optional(),
    url: z.string().url().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const hasCommand = Boolean(value.command);
    const hasUrl = Boolean(value.url);
    if (hasCommand === hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MCP config must include exactly one of "command" or "url".',
        path: ['command'],
      });
    }
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
