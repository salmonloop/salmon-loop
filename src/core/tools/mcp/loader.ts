import { z } from 'zod';

import { LIMITS } from '../../config/limits.js';
import type { ResolvedMcpServer } from '../../extensions/types.js';
import { logger } from '../../observability/logger.js';
import { ExecutionPhase, Phase } from '../../types/index.js';
import { ToolRegistry } from '../registry.js';
import type { ToolSpec } from '../types.js';

import { McpClient } from './client.js';
import { jsonSchemaToZod } from './schema.js';

const OUTPUT_SCHEMA = z
  .object({
    content: z.array(z.record(z.string(), z.any())),
  })
  .passthrough();

const PROCESS_SIDE_EFFECTS: ToolSpec['sideEffects'] = ['process', 'network'];
const ALLOWED_PHASES: ExecutionPhase[] = [Phase.VERIFY];

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return value === pattern;
}

function isToolAllowed(toolName: string, allowList: string[]): boolean {
  if (!allowList || allowList.length === 0) return false;
  return allowList.some((pattern) => matchesPattern(toolName, pattern));
}

export async function registerMcpTools(registry: ToolRegistry, servers: ResolvedMcpServer[]) {
  for (const server of servers) {
    if (!server.enabled) continue;

    if (!server.allowTools || server.allowTools.length === 0) {
      logger.warn(`MCP server ${server.name} has no tool allowlist; skipping registration.`);
      continue;
    }

    const client = new McpClient({
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
    });

    try {
      await client.start();
      const toolList = await client.listTools();
      if (!Array.isArray(toolList) || toolList.length === 0) {
        logger.warn(`MCP server ${server.name} reported no tools.`);
      }

      for (const tool of toolList) {
        const toolName = tool.name;
        if (!toolName) continue;

        if (!isToolAllowed(toolName, server.allowTools)) {
          continue;
        }

        const spec: ToolSpec = {
          name: `mcp.${server.name}.${toolName}`,
          source: 'mcp',
          intent: 'INFRA',
          description: tool.description || `MCP tool ${toolName}`,
          riskLevel: 'medium',
          sideEffects: PROCESS_SIDE_EFFECTS,
          concurrency: 'serial_only',
          allowedPhases: ALLOWED_PHASES,
          inputSchema: jsonSchemaToZod(tool.inputSchema),
          outputSchema: OUTPUT_SCHEMA,
          defaultTimeoutMs: LIMITS.defaultToolTimeoutMs,
          executor: async (input) => {
            const runtimeClient = new McpClient({
              name: server.name,
              command: server.command,
              args: server.args,
              env: server.env,
              cwd: server.cwd,
            });
            try {
              await runtimeClient.start();
              const result = await runtimeClient.callTool(toolName, input);
              return result;
            } finally {
              await runtimeClient.stop();
            }
          },
        };

        logger.info(`Registered MCP tool ${spec.name} from ${server.name}`);
        registry.register(spec);
      }
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to register MCP server ${server.name}: ${message}`);
    } finally {
      await client.stop();
    }
  }
}
