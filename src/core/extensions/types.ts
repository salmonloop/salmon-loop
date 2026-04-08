export type ExtensionScope = 'user' | 'repo';

export type ResolvedMcpServer =
  | {
      name: string;
      enabled: boolean;
      transport: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
      allowTools: string[];
      allowResources: string[];
      scope: ExtensionScope;
    }
  | {
      name: string;
      enabled: boolean;
      transport: 'http';
      url: string;
      headers: Record<string, string>;
      allowTools: string[];
      allowResources: string[];
      scope: ExtensionScope;
    };

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

export interface McpServerEntry {
  enabled?: boolean;
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  cwd?: string;
  allow?: {
    tools?: string[];
    resources?: string[];
  };
}

export interface ToolPluginEntry {
  enabled?: boolean;
  path: string;
  allowUserScope?: boolean;
}

export interface RawMcpConfig {
  version: 1;
  servers: Record<string, McpServerEntry>;
}

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
