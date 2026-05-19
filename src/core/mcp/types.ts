import type {
  CallToolResult,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  ServerCapabilities,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type { SideEffect, RiskLevel } from '../tools/types.js';
import type { LLM } from '../types/llm.js';
import type { ExecutionPhase, FlowMode, UserInputProvider } from '../types/runtime.js';

export type McpServerId = string;
export type McpTransportKind = 'stdio' | 'http';
export type McpTransportType = McpTransportKind;
export type McpTrustLevel = 'local' | 'remote';
export type McpAuthKind = 'none' | 'oauth';
export type McpAuthType = McpAuthKind;
export type McpCapabilityKind =
  | 'tools'
  | 'resources'
  | 'prompts'
  | 'roots'
  | 'sampling'
  | 'elicitation';
export type McpCapabilityName = McpCapabilityKind;
export type McpApprovalMode = 'never' | 'ask' | 'write_requires_confirmation';
export type McpPromptExposure = 'slash' | 'recipe' | 'none';
export type McpRootsMode = 'none' | 'repo' | 'worktree';

export interface McpStdioTransportConfig {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface McpHttpTransportConfig {
  type: 'http';
  url: string;
  headers: Record<string, string>;
}

export type McpTransportConfig = McpStdioTransportConfig | McpHttpTransportConfig;

export interface McpAuthConfig {
  type: McpAuthKind;
  scopes: string[];
}

export interface McpToolCapabilityConfig {
  exposeToModel: boolean;
  allow: string[];
  phases: ExecutionPhase[];
  approval: McpApprovalMode;
  sideEffectOverrides?: Record<string, SideEffect[]>;
}

export interface McpResourceCapabilityConfig {
  allowUris: string[];
  autoInclude: boolean;
  subscribe: boolean;
  maxBytes: number;
  ttlMs: number;
}

export interface McpPromptCapabilityConfig {
  exposeAs: McpPromptExposure;
  allow: string[];
}

export interface McpRootsCapabilityConfig {
  mode: McpRootsMode;
}

export interface McpSamplingCapabilityConfig {
  enabled: boolean;
  maxTokens: number;
  maxDepth: number;
}

export interface McpElicitationCapabilityConfig {
  enabled: boolean;
}

export interface McpServerCapabilityConfig {
  tools: McpToolCapabilityConfig;
  resources: McpResourceCapabilityConfig;
  prompts: McpPromptCapabilityConfig;
  roots: McpRootsCapabilityConfig;
  sampling: McpSamplingCapabilityConfig;
  elicitation: McpElicitationCapabilityConfig;
}

export interface McpServerConfigV2 {
  enabled?: boolean;
  transport: McpTransportConfig;
  auth: McpAuthConfig;
  trust: McpTrustLevel;
  capabilities: McpServerCapabilityConfig;
}

export interface McpConfigV2 {
  version: 2;
  servers: Record<McpServerId, McpServerConfigV2>;
}

export interface ResolvedMcpServerV2 {
  name: McpServerId;
  enabled: boolean;
  transport: McpTransportConfig;
  auth: McpAuthConfig;
  trust: McpTrustLevel;
  capabilities: McpServerCapabilityConfig;
  scope: 'user' | 'repo';
}

export type McpServerConfig = McpServerConfigV2;
export type ResolvedMcpServer = ResolvedMcpServerV2;

export type McpToolDescriptor = Tool & {
  serverName: McpServerId;
};

export type McpResourceDescriptor = Resource & {
  serverName: McpServerId;
};

export type McpResourceTemplateDescriptor = ResourceTemplate & {
  serverName: McpServerId;
};

export type McpPromptDescriptor = Prompt & {
  serverName: McpServerId;
};

export interface McpCatalogSnapshot {
  serverName: McpServerId;
  capabilities?: ServerCapabilities;
  tools: McpToolDescriptor[];
  resources: McpResourceDescriptor[];
  resourceTemplates: McpResourceTemplateDescriptor[];
  prompts: McpPromptDescriptor[];
  refreshedAt: string;
  stale: boolean;
}

export type McpConnectionStatus = 'idle' | 'connecting' | 'ready' | 'degraded' | 'closed';

export interface McpConnectionView {
  serverName: McpServerId;
  status: McpConnectionStatus;
  capabilities?: ServerCapabilities;
  error?: string;
}

export interface McpClientCapabilitiesInput {
  roots?: boolean;
  sampling?: boolean;
  elicitation?: boolean;
}

export interface McpRuntimeContext {
  repoRoot: string;
  worktreeRoot?: string;
  flowMode?: FlowMode;
  phase?: ExecutionPhase;
  signal?: AbortSignal;
  llm?: LLM;
  userInputProvider?: UserInputProvider;
}

export interface McpToolClassification {
  riskLevel: RiskLevel;
  sideEffects: SideEffect[];
}

export interface McpToolCallResult {
  result: CallToolResult;
  structuredContent?: unknown;
  resourceLinks?: unknown[];
}

export type McpReadResourceResult = ReadResourceResult;
export type McpGetPromptResult = GetPromptResult;
