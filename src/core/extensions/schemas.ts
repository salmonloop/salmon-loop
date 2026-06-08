import { z } from 'zod';

import { McpConfigV2Schema } from '../mcp/config/schema-v2.js';

export const McpConfigSchema = McpConfigV2Schema;

const toolPluginSchema = z.object({
  enabled: z.boolean().optional(),
  path: z.string(),
  allowUserScope: z.boolean().optional(),
});

export const ToolsConfigSchema = z.object({
  version: z.literal(1),
  plugins: z.record(z.string(), toolPluginSchema).optional().default({}),
});

const skillDiscoverySchema = z
  .object({
    paths: z.array(z.string()).optional(),
  })
  .strict();

export const SkillsConfigSchema = z
  .object({
    version: z.literal(1),
    discovery: skillDiscoverySchema.optional().default({}),
  })
  .strict();

export const AgentProfileConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string(),
  allowedTools: z.array(z.string()).optional(),
  toolInheritance: z.enum(['none', 'safe', 'all']).optional(),
  permissionMode: z.enum(['default', 'plan', 'bypassPermissions']).optional(),
  systemPrompt: z.string().optional(),
  readOnly: z.boolean().optional(),
  stratagem: z.enum(['investigator', 'surgeon', 'janitor']).optional(),
  maxTokens: z.number().positive().optional(),
  maxAttempts: z.number().positive().optional(),
  timeoutMs: z.number().positive().optional(),
  model: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const AgentsConfigSchema = z.object({
  version: z.literal(1),
  agents: z.array(AgentProfileConfigSchema),
});
