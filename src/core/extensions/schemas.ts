import { z } from 'zod';

const mcpAllowSchema = z.object({
  tools: z.array(z.string()).optional(),
  resources: z.array(z.string()).optional(),
});

const mcpServerSchema = z
  .object({
    enabled: z.boolean().optional(),
    command: z.string().optional(),
    url: z.string().url().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
    allow: mcpAllowSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasCommand = Boolean(value.command);
    const hasUrl = Boolean(value.url);
    if (hasCommand === hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MCP server entry must include exactly one of "command" or "url".',
        path: ['command'],
      });
    }
    if (hasUrl && value.args && value.args.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"args" is only valid for stdio MCP servers ("command" transport).',
        path: ['args'],
      });
    }
    if (hasUrl && value.cwd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"cwd" is only valid for stdio MCP servers ("command" transport).',
        path: ['cwd'],
      });
    }
    if (hasUrl && value.env && Object.keys(value.env).length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '"env" is only valid for stdio MCP servers ("command" transport).',
        path: ['env'],
      });
    }
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
