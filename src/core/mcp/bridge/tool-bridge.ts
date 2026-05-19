import { z } from 'zod';

import { LIMITS } from '../../config/limits.js';
import type {
  ConcurrencyHint,
  RiskLevel,
  SideEffect,
  ToolIntent,
  ToolSpec,
} from '../../tools/types.js';
import { Phase, type ExecutionPhase } from '../../types/runtime.js';
import type { McpConnectionManager } from '../client/connection-manager.js';
import type { McpPolicyEngine } from '../policy/approval-policy.js';
import { classifyMcpTool } from '../policy/classifier.js';
import { jsonSchemaToZod } from '../schema/json-schema-to-zod.js';
import type {
  McpServerCapabilityConfig,
  McpToolClassification as NativeMcpToolClassification,
  McpToolDescriptor as NativeMcpToolDescriptor,
  ResolvedMcpServerV2,
} from '../types.js';

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    [key: string]: unknown;
  };
  title?: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface McpPolicyGrant {
  allowedPhases: ExecutionPhase[];
  grantedBy?: string;
  grantedAt?: string;
  riskLevel?: RiskLevel;
  intent?: ToolIntent;
  concurrency?: ConcurrencyHint;
  defaultTimeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export type McpToolSideEffectClassification =
  | {
      kind: 'classified';
      sideEffects: SideEffect[];
      riskLevel?: RiskLevel;
      concurrency?: ConcurrencyHint;
      intent?: ToolIntent;
      reason?: string;
    }
  | {
      kind: 'fallback';
      reason: string;
      sideEffects?: SideEffect[];
      riskLevel?: RiskLevel;
      concurrency?: ConcurrencyHint;
      intent?: ToolIntent;
    };

export interface McpFacetClassifierResult {
  risk: RiskLevel;
  facets: {
    read: boolean;
    write: boolean;
    network: boolean;
    process: boolean;
  };
  reasons: string[];
}

export type McpBridgeClassifierInput =
  | McpToolSideEffectClassification
  | NativeMcpToolClassification
  | McpFacetClassifierResult;

export interface McpToolCallResult {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  resourceLinks?: unknown[];
  result?: {
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    _meta?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface McpLongConnectionManager {
  callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<McpToolCallResult>;
}

export interface McpToolBridgeInput {
  serverName: string;
  descriptor: McpToolDescriptor;
  grant: McpPolicyGrant;
  classification: McpBridgeClassifierInput;
  manager: McpLongConnectionManager;
}

export interface BridgedMcpToolOutput {
  content: unknown[];
  structuredContent?: Record<string, unknown>;
  resourceLinks: unknown[];
  raw: McpToolCallResult;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const FALLBACK_SIDE_EFFECTS: SideEffect[] = ['process', 'network'];
const FALLBACK_ALLOWED_PHASES: ExecutionPhase[] = [Phase.VERIFY];

const mcpContentItemSchema = z.object({}).catchall(z.unknown());
const mcpCallResultSchema = z
  .object({
    content: z.array(mcpContentItemSchema).default([]),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
    isError: z.boolean().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const bridgedMcpToolOutputObjectSchema = z
  .object({
    content: z.array(mcpContentItemSchema),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
    resourceLinks: z.array(mcpContentItemSchema),
    raw: mcpCallResultSchema,
    isError: z.boolean().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const bridgedMcpToolOutputSchema: z.ZodType<BridgedMcpToolOutput> =
  bridgedMcpToolOutputObjectSchema;

export function mcpToolDescriptorToToolSpec(input: McpToolBridgeInput): ToolSpec {
  assertMcpName(input.serverName, 'server');
  assertMcpName(input.descriptor.name, 'tool');

  const classification = normalizeClassifierInput(input.classification);
  const sideEffects = resolveSideEffects(classification);
  const riskLevel =
    input.grant.riskLevel ??
    classification.riskLevel ??
    inferRiskLevel(sideEffects, classification.kind);
  const concurrency =
    input.grant.concurrency ??
    classification.concurrency ??
    inferConcurrency(sideEffects, riskLevel);
  const allowedPhases =
    input.grant.allowedPhases.length > 0 ? input.grant.allowedPhases : FALLBACK_ALLOWED_PHASES;
  const mcpOutputSchema = input.descriptor.outputSchema
    ? jsonSchemaToZod(input.descriptor.outputSchema).optional()
    : z.any().optional();

  return {
    name: toModelToolName(input.serverName, input.descriptor.name),
    source: 'mcp',
    intent: input.grant.intent ?? classification.intent ?? inferIntent(sideEffects),
    description:
      input.descriptor.description ?? input.descriptor.title ?? `MCP tool ${input.descriptor.name}`,
    riskLevel,
    sideEffects,
    concurrency,
    allowedPhases,
    defaultTimeoutMs: input.grant.defaultTimeoutMs ?? LIMITS.defaultToolTimeoutMs,
    inputSchema: jsonSchemaToZod(input.descriptor.inputSchema),
    outputSchema: bridgedMcpToolOutputObjectSchema.extend({
      structuredContent: mcpOutputSchema,
    }),
    summarizeArgsForAuthorization: async (args) =>
      summarizeMcpAuthorization({ ...input, classification }, args, riskLevel, sideEffects),
    executor: async (rawInput, ctx) => {
      const args = coerceRecord(rawInput);
      const result = await input.manager.callTool(input.serverName, input.descriptor.name, args, {
        signal: ctx.signal,
      });
      return wrapMcpToolResult(result);
    },
  };
}

export function mcpClassifierResultToBridgeClassification(
  classification: NativeMcpToolClassification | McpFacetClassifierResult,
): McpToolSideEffectClassification {
  if ('sideEffects' in classification) {
    return {
      kind: 'classified',
      sideEffects: classification.sideEffects,
      riskLevel: classification.riskLevel,
      concurrency: inferConcurrency(classification.sideEffects, classification.riskLevel),
      intent: inferIntent(classification.sideEffects),
    };
  }

  const sideEffects = sideEffectsFromFacetClassifier(classification.facets);
  return {
    kind: 'classified',
    sideEffects,
    riskLevel: classification.risk,
    concurrency: inferConcurrency(sideEffects, classification.risk),
    intent: inferIntent(sideEffects),
    reason: classification.reasons.join('; '),
  };
}

export function wrapMcpToolResult(result: McpToolCallResult): BridgedMcpToolOutput {
  const normalized = unwrapMcpCallResult(result);
  const content = Array.isArray(normalized.content) ? normalized.content : [];
  const directResourceLinks = Array.isArray(result.resourceLinks) ? result.resourceLinks : [];
  const resourceLinks = [...directResourceLinks, ...content.filter(isResourceLink)];
  const output: BridgedMcpToolOutput = {
    content,
    resourceLinks,
    raw: {
      ...normalized,
      content,
    },
  };

  if (normalized.structuredContent !== undefined) {
    output.structuredContent = normalized.structuredContent;
  }
  if (normalized.isError !== undefined) {
    output.isError = normalized.isError;
  }
  if (normalized._meta !== undefined) {
    output._meta = normalized._meta;
  }

  return output;
}

export function mcpToolToToolSpec(input: {
  server: ResolvedMcpServerV2;
  tool: NativeMcpToolDescriptor;
  manager: McpConnectionManager;
  policy: McpPolicyEngine;
}): ToolSpec {
  const override = findOverride(input.server.capabilities, input.tool.name);
  const classification = classifyMcpTool({
    tool: input.tool as any,
    trust: input.server.trust,
    override,
  });
  const phase = input.server.capabilities.tools.phases[0] ?? Phase.VERIFY;
  const grantDecision = input.policy.decideTool({
    server: input.server.name,
    toolName: input.tool.name,
    phase,
    classification,
  });
  const toolGrant =
    grantDecision.grant?.kind === 'tool'
      ? grantDecision.grant
      : {
          phases: input.server.capabilities.tools.phases,
          approval: input.server.capabilities.tools.approval,
        };
  const grant: McpPolicyGrant = {
    allowedPhases: toolGrant.phases,
    riskLevel: classification.riskLevel,
    metadata: {
      approval: toolGrant.approval,
      policy: grantDecision.grant,
    },
  };

  const spec = mcpToolDescriptorToToolSpec({
    serverName: input.server.name,
    descriptor: input.tool as McpToolDescriptor,
    grant,
    classification,
    manager: input.manager as McpLongConnectionManager,
  });

  return {
    ...spec,
    executor: async (args, ctx) => {
      const runtimePhase = ctx.phase ?? phase;
      const decision = input.policy.decideTool({
        server: input.server.name,
        toolName: input.tool.name,
        phase: runtimePhase,
        classification,
      });
      if (decision.outcome === 'deny') throw new Error(decision.denyReason ?? 'MCP_TOOL_DENIED');
      return spec.executor(args, ctx);
    },
  };
}

export async function registerMcpV2Tools(input: {
  registry: { register: (spec: ToolSpec) => void };
  servers: ResolvedMcpServerV2[];
  manager: McpConnectionManager;
  policy: McpPolicyEngine;
}): Promise<void> {
  await input.manager.startAll();
  for (const server of input.servers) {
    if (!server.enabled || !server.capabilities.tools.exposeToModel) continue;
    const catalog = input.manager.getCatalog(server.name);
    if (!catalog) continue;
    for (const tool of catalog.tools) {
      const classification = classifyMcpTool({ tool: tool as any, trust: server.trust });
      const decision = input.policy.decideTool({
        server: server.name,
        toolName: tool.name,
        phase: server.capabilities.tools.phases[0] ?? Phase.VERIFY,
        classification,
      });
      if (decision.outcome === 'deny') continue;
      input.registry.register(
        mcpToolToToolSpec({
          server,
          tool,
          manager: input.manager,
          policy: input.policy,
        }),
      );
    }
  }
}

function normalizeClassifierInput(
  classification: McpBridgeClassifierInput,
): McpToolSideEffectClassification {
  if ('kind' in classification) {
    return classification;
  }
  return mcpClassifierResultToBridgeClassification(classification);
}

function sideEffectsFromFacetClassifier(facets: McpFacetClassifierResult['facets']): SideEffect[] {
  const effects: SideEffect[] = [];
  if (facets.read) effects.push('fs_read');
  if (facets.write) effects.push('fs_write');
  if (facets.process) effects.push('process');
  if (facets.network) effects.push('network');
  return effects.length > 0 ? effects : ['none'];
}

function assertMcpName(value: string, label: string): void {
  if (!MCP_NAME_PATTERN.test(value)) {
    throw new Error(`Invalid MCP ${label} name: ${value}`);
  }
}

function toModelToolName(serverName: string, toolName: string): string {
  return `mcp.${serverName}.${toolName}`;
}

function findOverride(
  capabilities: McpServerCapabilityConfig,
  toolName: string,
): SideEffect[] | undefined {
  return capabilities.tools.sideEffectOverrides?.[toolName];
}

function resolveSideEffects(classification: McpToolSideEffectClassification): SideEffect[] {
  const effects =
    classification.kind === 'fallback'
      ? classification.sideEffects && classification.sideEffects.length > 0
        ? classification.sideEffects
        : FALLBACK_SIDE_EFFECTS
      : classification.sideEffects;
  return effects.length > 0 ? dedupeSideEffects(effects) : ['none'];
}

function dedupeSideEffects(sideEffects: SideEffect[]): SideEffect[] {
  return Array.from(new Set(sideEffects));
}

function inferRiskLevel(sideEffects: SideEffect[], classificationKind: string): RiskLevel {
  if (classificationKind === 'fallback') return 'high';
  if (
    sideEffects.some((effect) =>
      ['fs_write', 'git_write', 'runtime_write', 'snapshot_mutate', 'process', 'network'].includes(
        effect,
      ),
    )
  ) {
    return 'high';
  }
  return 'low';
}

function inferConcurrency(sideEffects: SideEffect[], riskLevel: RiskLevel): ConcurrencyHint {
  if (riskLevel === 'high') return 'serial_only';
  if (
    sideEffects.every(
      (effect) => effect === 'none' || effect === 'fs_read' || effect === 'git_read',
    )
  ) {
    return 'parallel_ok';
  }
  return 'serial_only';
}

function inferIntent(sideEffects: SideEffect[]): ToolIntent {
  if (sideEffects.includes('fs_write') || sideEffects.includes('git_write')) return 'WRITE';
  if (sideEffects.includes('fs_read') || sideEffects.includes('git_read')) return 'READ';
  return 'INFRA';
}

function summarizeMcpAuthorization(
  input: McpToolBridgeInput & { classification: McpToolSideEffectClassification },
  args: unknown,
  riskLevel: RiskLevel,
  sideEffects: SideEffect[],
): string {
  const payload = {
    server: input.serverName,
    tool: input.descriptor.name,
    riskLevel,
    sideEffects,
    grant: {
      allowedPhases: input.grant.allowedPhases,
      grantedBy: input.grant.grantedBy,
      grantedAt: input.grant.grantedAt,
      metadata: input.grant.metadata,
    },
    classification:
      input.classification.kind === 'fallback'
        ? { kind: 'fallback', reason: input.classification.reason }
        : { kind: 'classified', reason: input.classification.reason },
    args,
  };
  return safeStringify(payload);
}

function safeStringify(value: unknown, maxLength = 1200): string {
  try {
    const raw = JSON.stringify(value);
    return raw.length <= maxLength ? raw : `${raw.slice(0, maxLength)}...`;
  } catch {
    return '[Unserializable]';
  }
}

function coerceRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function unwrapMcpCallResult(result: McpToolCallResult): McpToolCallResult {
  if (result.result && typeof result.result === 'object' && !Array.isArray(result.result)) {
    return {
      ...result.result,
      structuredContent: result.structuredContent ?? result.result.structuredContent,
      resourceLinks: result.resourceLinks,
    };
  }
  return result;
}

function isResourceLink(item: unknown): item is Record<string, unknown> {
  return Boolean(
    item &&
    typeof item === 'object' &&
    (item as { type?: unknown }).type === 'resource_link' &&
    typeof (item as { uri?: unknown }).uri === 'string',
  );
}
