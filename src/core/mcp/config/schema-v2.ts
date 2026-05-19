import { z } from 'zod';

import { Phase, type ExecutionPhase } from '../../types/runtime.js';
import type {
  McpApprovalMode,
  McpPromptExposure,
  McpRootsMode,
  McpServerCapabilityConfig,
} from '../types.js';

const phases = Object.values(Phase) as [ExecutionPhase, ...ExecutionPhase[]];

const transportSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('stdio'),
      command: z.string().min(1),
      args: z.array(z.string()).optional().default([]),
      env: z.record(z.string(), z.string()),
      cwd: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('http'),
      url: z.string().url(),
      headers: z.record(z.string(), z.string()).optional().default({}),
    })
    .strict(),
]);

const authSchema = z
  .object({
    type: z.enum(['none', 'oauth']).optional().default('none'),
    scopes: z.array(z.string()).optional().default([]),
  })
  .strict()
  .default({ type: 'none', scopes: [] });

const toolsCapabilitySchema = z
  .object({
    exposeToModel: z.boolean().optional().default(false),
    allow: z.array(z.string()).optional().default([]),
    phases: z.array(z.enum(phases)).optional().default([]),
    approval: z
      .enum(['never', 'ask', 'write_requires_confirmation'] satisfies [
        McpApprovalMode,
        McpApprovalMode,
        McpApprovalMode,
      ])
      .optional()
      .default('ask'),
    sideEffectOverrides: z
      .record(
        z.string(),
        z.array(
          z.enum([
            'none',
            'fs_read',
            'fs_write',
            'runtime_write',
            'process',
            'network',
            'git_read',
            'git_write',
            'snapshot_mutate',
          ]),
        ),
      )
      .optional(),
  })
  .strict();

const resourcesCapabilitySchema = z
  .object({
    allowUris: z.array(z.string()).optional().default([]),
    autoInclude: z.boolean().optional().default(false),
    subscribe: z.boolean().optional().default(false),
    maxBytes: z.number().int().positive().optional().default(64_000),
    ttlMs: z.number().int().nonnegative().optional().default(30_000),
  })
  .strict();

const promptsCapabilitySchema = z
  .object({
    exposeAs: z
      .enum(['slash', 'recipe', 'none'] satisfies [
        McpPromptExposure,
        McpPromptExposure,
        McpPromptExposure,
      ])
      .optional()
      .default('none'),
    allow: z.array(z.string()).optional().default([]),
  })
  .strict();

const rootsCapabilitySchema = z
  .object({
    mode: z
      .enum(['none', 'repo', 'worktree'] satisfies [McpRootsMode, McpRootsMode, McpRootsMode])
      .optional()
      .default('none'),
  })
  .strict();

const samplingCapabilitySchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    maxTokens: z.number().int().nonnegative().optional().default(0),
    maxDepth: z.number().int().nonnegative().optional().default(0),
  })
  .strict();

const elicitationCapabilitySchema = z
  .object({
    enabled: z.boolean().optional().default(false),
  })
  .strict();

export const McpCapabilitiesV2Schema = z
  .object({
    tools: toolsCapabilitySchema.optional(),
    resources: resourcesCapabilitySchema.optional(),
    prompts: promptsCapabilitySchema.optional(),
    roots: rootsCapabilitySchema.optional(),
    sampling: samplingCapabilitySchema.optional(),
    elicitation: elicitationCapabilitySchema.optional(),
  })
  .strict()
  .optional()
  .transform(
    (value): McpServerCapabilityConfig => ({
      tools: toolsCapabilitySchema.parse(value?.tools ?? {}),
      resources: resourcesCapabilitySchema.parse(value?.resources ?? {}),
      prompts: promptsCapabilitySchema.parse(value?.prompts ?? {}),
      roots: rootsCapabilitySchema.parse(value?.roots ?? {}),
      sampling: samplingCapabilitySchema.parse(value?.sampling ?? {}),
      elicitation: elicitationCapabilitySchema.parse(value?.elicitation ?? {}),
    }),
  );

export const McpServerEntryV2Schema = z
  .object({
    enabled: z.boolean().optional(),
    transport: transportSchema,
    auth: authSchema,
    trust: z.enum(['local', 'remote']).optional(),
    capabilities: McpCapabilitiesV2Schema,
  })
  .strict()
  .transform((value) => ({
    ...value,
    trust: value.trust ?? (value.transport.type === 'stdio' ? 'local' : 'remote'),
  }));

export const McpConfigV2Schema = z
  .object({
    version: z.literal(2),
    servers: z.record(z.string(), McpServerEntryV2Schema).optional().default({}),
  })
  .strict();

export type RawMcpConfigV2 = z.infer<typeof McpConfigV2Schema>;
export type RawMcpServerEntryV2 = z.infer<typeof McpServerEntryV2Schema>;
