export type ExtensionScope = 'user' | 'repo';

export type {
  McpApprovalMode,
  McpAuthConfig,
  McpAuthKind,
  McpAuthType,
  McpCapabilityKind,
  McpCapabilityName,
  McpConfigV2,
  McpElicitationCapabilityConfig,
  McpHttpTransportConfig,
  McpPromptCapabilityConfig,
  McpPromptExposure,
  McpResourceCapabilityConfig,
  McpRootsCapabilityConfig,
  McpRootsMode,
  McpSamplingCapabilityConfig,
  McpServerCapabilityConfig,
  McpServerConfig,
  McpServerConfigV2,
  McpServerId,
  McpStdioTransportConfig,
  McpToolCapabilityConfig,
  McpTransportConfig,
  McpTransportKind,
  McpTransportType,
  McpTrustLevel,
  ResolvedMcpServer,
  ResolvedMcpServerV2,
} from '../mcp/types.js';

import type { RawMcpConfigV2, RawMcpServerEntryV2 } from '../mcp/config/schema-v2.js';
import type { ResolvedMcpServer } from '../mcp/types.js';

export interface ResolvedToolPlugin {
  id: string;
  enabled: boolean;
  path: string;
  allowUserScope: boolean;
  scope: ExtensionScope;
}

export interface ResolvedSkillDiscovery {
  paths: string[];
  scope: ExtensionScope;
}

export interface ResolvedExtensions {
  mcpServers: ResolvedMcpServer[];
  toolPlugins: ResolvedToolPlugin[];
  skillDiscovery: ResolvedSkillDiscovery;
}

export type McpServerEntry = RawMcpServerEntryV2;

export interface ToolPluginEntry {
  enabled?: boolean;
  path: string;
  allowUserScope?: boolean;
}

export type RawMcpConfig = RawMcpConfigV2;

export interface RawToolConfig {
  version: 1;
  plugins: Record<string, ToolPluginEntry>;
}

export interface RawSkillConfig {
  version: 1;
  discovery: {
    paths?: string[];
  };
}
