import path from 'node:path';

import { buildResolvedMcpServersV2 } from '../mcp/config/index.js';
import { getLogger } from '../observability/logger.js';

import { loadConfig } from './load.js';
import { mergeScopedEntries, ScopedEntry } from './merge.js';
import {
  expandHome,
  getRepoMcpConfigPath,
  getRepoSkillConfigPath,
  getRepoToolConfigPath,
  getUserMcpConfigPath,
  getUserSkillConfigPath,
  getUserToolConfigPath,
  isWithinRoot,
  resolveRepoRelative,
  resolveUserRelative,
} from './paths.js';
import { redactExtensions } from './redact.js';
import { McpConfigSchema, SkillsConfigSchema, ToolsConfigSchema } from './schemas.js';
import type {
  ExtensionScope,
  RawMcpConfig,
  RawSkillConfig,
  RawToolConfig,
  ResolvedExtensions,
  ResolvedSkillDiscovery,
  ResolvedToolPlugin,
  ToolPluginEntry,
} from './types.js';

export interface ResolveExtensionsOptions {
  repoRoot: string;
}

export interface ExtensionResolution {
  resolved: ResolvedExtensions;
  rawEffective: {
    mcp: RawMcpConfig | null;
    tools: RawToolConfig | null;
    skills: RawSkillConfig | null;
  };
  redacted: ResolvedExtensions;
}

function defaultEnabled(scope: ExtensionScope) {
  return scope === 'repo';
}

function resolvePathForScope(
  value: string | undefined,
  scope: ExtensionScope,
  repoRoot: string,
): string | undefined {
  if (!value) return undefined;
  const expanded = expandHome(value);
  return scope === 'repo' ? resolveRepoRelative(repoRoot, expanded) : resolveUserRelative(expanded);
}

function buildResolvedPlugins(
  entries: ScopedEntry<ToolPluginEntry>[],
  repoRoot: string,
): ResolvedToolPlugin[] {
  return entries.map((entry) => {
    const scope = entry.scope;
    const source = entry.entry;
    const enabled = source.enabled ?? defaultEnabled(scope);
    return {
      id: entry.key,
      enabled,
      path: resolvePathForScope(source.path, scope, repoRoot) ?? source.path,
      allowUserScope: source.allowUserScope ?? false,
      scope,
    };
  });
}

function buildResolvedSkills(
  user?: RawSkillConfig,
  repo?: RawSkillConfig,
  repoRoot?: string,
): ResolvedSkillDiscovery {
  const repoDiscovery = repo?.discovery;
  const userDiscovery = user?.discovery;
  const repoPaths =
    repoDiscovery && Array.isArray(repoDiscovery.paths) ? repoDiscovery.paths : undefined;
  const userPaths =
    userDiscovery && Array.isArray(userDiscovery.paths) ? userDiscovery.paths : undefined;
  let scope: ExtensionScope = 'repo';
  let paths: string[] = [];

  if (repoPaths && repoPaths.length > 0) {
    scope = 'repo';
    const root = repoRoot ?? '';
    paths = repoPaths
      .filter((raw) => {
        // Reject absolute paths in repo scope — only user-level config may specify them
        const expanded = expandHome(raw);
        if (path.isAbsolute(expanded)) {
          getLogger().audit(
            'SKILL_PATH_REJECTED',
            { path: raw, repoRoot: root, reason: 'absolute_path_in_repo_scope' },
            { source: 'skill-loader', severity: 'high', scope: 'repo' },
          );
          return false;
        }
        return true;
      })
      .map((value) => resolvePathForScope(value, 'repo', root))
      .filter((p): p is string => Boolean(p))
      .filter((p) => {
        // Validate resolved paths stay within repo root
        if (!isWithinRoot(p, root)) {
          getLogger().audit(
            'SKILL_PATH_REJECTED',
            { path: p, repoRoot: root, reason: 'outside_repo_root' },
            { source: 'skill-loader', severity: 'high', scope: 'repo' },
          );
          return false;
        }
        return true;
      });
  } else if (userPaths && userPaths.length > 0) {
    scope = 'user';
    paths = userPaths
      .map((value) => resolvePathForScope(value, 'user', repoRoot ?? ''))
      .filter((p): p is string => Boolean(p));
  }

  return {
    paths,
    scope,
  };
}

export async function resolveExtensions(
  options: ResolveExtensionsOptions,
): Promise<ExtensionResolution> {
  const { repoRoot } = options;
  const [userMcp, repoMcp, userTools, repoTools, userSkills, repoSkills] = await Promise.all([
    loadConfig<RawMcpConfig>(getUserMcpConfigPath(), McpConfigSchema),
    loadConfig<RawMcpConfig>(getRepoMcpConfigPath(repoRoot), McpConfigSchema),
    loadConfig<RawToolConfig>(getUserToolConfigPath(), ToolsConfigSchema),
    loadConfig<RawToolConfig>(getRepoToolConfigPath(repoRoot), ToolsConfigSchema),
    loadConfig<RawSkillConfig>(getUserSkillConfigPath(), SkillsConfigSchema),
    loadConfig<RawSkillConfig>(getRepoSkillConfigPath(repoRoot), SkillsConfigSchema),
  ]);

  const mergedServers = mergeScopedEntries(userMcp?.config.servers, repoMcp?.config.servers);
  const mergedPlugins = mergeScopedEntries(userTools?.config.plugins, repoTools?.config.plugins);

  const resolved: ResolvedExtensions = {
    mcpServers: buildResolvedMcpServersV2(mergedServers, repoRoot),
    toolPlugins: buildResolvedPlugins(mergedPlugins, repoRoot),
    skillDiscovery: buildResolvedSkills(userSkills?.config, repoSkills?.config, repoRoot),
  };

  const rawEffective = {
    mcp: repoMcp?.config ?? userMcp?.config ?? null,
    tools: repoTools?.config ?? userTools?.config ?? null,
    skills: repoSkills?.config ?? userSkills?.config ?? null,
  };

  return {
    resolved,
    rawEffective,
    redacted: redactExtensions(resolved),
  };
}

export { ExtensionConfigError } from './load.js';
