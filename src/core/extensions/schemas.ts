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
