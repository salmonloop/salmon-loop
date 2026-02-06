import { z } from 'zod';

const mcpAllowSchema = z.object({
  tools: z.array(z.string()).optional(),
  resources: z.array(z.string()).optional(),
});

const mcpServerSchema = z.object({
  enabled: z.boolean().optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  allow: mcpAllowSchema.optional(),
});

export const McpConfigSchema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), mcpServerSchema).optional().default({}),
});

const toolPluginSchema = z.object({
  enabled: z.boolean().optional(),
  path: z.string(),
  allowUserScope: z.boolean().optional(),
});

export const ToolsConfigSchema = z.object({
  version: z.literal(1),
  plugins: z.record(z.string(), toolPluginSchema).optional().default({}),
});

const skillDiscoverySchema = z.object({
  useDefaults: z.boolean().optional(),
  paths: z.array(z.string()).optional(),
});

export const SkillsConfigSchema = z.object({
  version: z.literal(1),
  discovery: skillDiscoverySchema.optional().default({}),
});
