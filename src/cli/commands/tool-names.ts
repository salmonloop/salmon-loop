import * as os from 'os';
import * as path from 'path';

import {
  getLogger,
  registerAllBuiltins,
  resolveExtensions,
  skillToToolSpec,
  SkillLoader,
  ToolRegistry,
  type RouterBox,
  type SideEffect,
  type ToolRouter,
} from '../../core/facades/cli-command-tool-names.js';
import {
  stat,
  statSync,
} from '../utils/safe-fs.js';

const VALID_SIDE_EFFECTS = new Set<SideEffect>([
  'none',
  'fs_read',
  'fs_write',
  'process',
  'network',
  'git_read',
  'git_write',
]);

// Cache key includes repoRoot. Extensions config is not part of the key because
// tool-names is used for tab completion where extensions may not be available.
const toolNameCache = new Map<string, { names: Set<string>; signature: string }>();

/**
 * Compute a cache-invalidation signature based on mtime of all skill search
 * paths that SkillLoader would scan. Mirrors the 7-level priority order.
 */
async function computeSkillSignature(repoRoot: string, extraPaths: string[] = []): Promise<string> {
  const searchPaths = [
    ...extraPaths,
    path.join(repoRoot, '.salmonloop', 'skills'),
    path.join(repoRoot, '.agents', 'skills'),
    path.join(repoRoot, '.claude', 'skills'),
    path.join(os.homedir(), '.salmonloop', 'skills'),
    path.join(os.homedir(), '.agents', 'skills'),
    path.join(os.homedir(), '.claude', 'skills'),
  ];
  const parts: string[] = [];
  for (const searchPath of searchPaths) {
    try {
      const stats = await stat(searchPath);
      parts.push(`${searchPath}:${stats.mtimeMs}`);
    } catch {
      parts.push(`${searchPath}:missing`);
    }
  }
  return parts.join('|');
}

function computeSkillSignatureSync(repoRoot: string): string {
  const searchPaths = [
    path.join(repoRoot, '.salmonloop', 'skills'),
    path.join(repoRoot, '.agents', 'skills'),
    path.join(repoRoot, '.claude', 'skills'),
    path.join(os.homedir(), '.salmonloop', 'skills'),
    path.join(os.homedir(), '.agents', 'skills'),
    path.join(os.homedir(), '.claude', 'skills'),
  ];
  const parts: string[] = [];
  for (const searchPath of searchPaths) {
    try {
      const stats = statSync(searchPath);
      parts.push(`${searchPath}:${stats.mtimeMs}`);
    } catch {
      parts.push(`${searchPath}:missing`);
    }
  }
  return parts.join('|');
}

/**
 * Get all known tool names including skills.
 *
 * Uses `resolveExtensions` to obtain the same SkillLoader configuration
 * (extraPaths, useDefaults, legacyDirectMd) as the main runtime, so that
 * tool-name discovery and actual runtime skill availability stay consistent.
 */
export async function getKnownToolNames(repoRoot: string): Promise<Set<string>> {
  // Resolve extensions to get the same loader config as the runtime
  let skillDiscovery: { useDefaults?: boolean; paths?: string[]; legacyDirectMd?: boolean } = {};
  try {
    const { resolved } = await resolveExtensions({ repoRoot });
    skillDiscovery = resolved.skillDiscovery;
  } catch {
    // Extensions config unavailable — fall back to loader defaults
  }

  const extraPaths = skillDiscovery.paths ?? [];
  const signature = await computeSkillSignature(repoRoot, extraPaths);
  const cached = toolNameCache.get(repoRoot);
  if (cached && cached.signature === signature) return cached.names;

  const registry = new ToolRegistry();
  registerAllBuiltins(registry);

  const routerBox: RouterBox = { router: null as unknown as ToolRouter };
  const skillLoader = new SkillLoader({
    repoRoot,
    useDefaults: skillDiscovery.useDefaults,
    extraPaths,
    legacyDirectMd: skillDiscovery.legacyDirectMd,
  });
  const skills = await skillLoader.initialize();
  for (const skill of skills) {
    try {
      // Name-only registration: executor is never called, so null router is safe.
      registry.register(skillToToolSpec(skill, routerBox));
    } catch (error) {
      const label = skill.metadata?.name || skill.id;
      getLogger().warn(
        `Failed to register skill ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const names = new Set(registry.listAll().map((spec) => spec.name));
  toolNameCache.set(repoRoot, { names, signature });
  return names;
}

/**
 * Synchronous variant for tab completion only.
 *
 * @nonAuthoritative This returns a best-effort approximation of known tool
 * names using loader defaults (no extensions resolution, since
 * resolveExtensions is async). The result may differ from the actual runtime
 * tool set when custom `skills.json` discovery paths are configured.
 *
 * DO NOT use this for security decisions (allowlist enforcement, permission
 * checks). Use the async {@link getKnownToolNames} instead, which resolves
 * extensions for full consistency with the runtime.
 */
export function getKnownToolNamesSync(repoRoot: string): Set<string> {
  const signature = computeSkillSignatureSync(repoRoot);
  const cached = toolNameCache.get(repoRoot);
  if (cached && cached.signature === signature) return cached.names;

  const registry = new ToolRegistry();
  registerAllBuiltins(registry);

  const routerBox: RouterBox = { router: null as unknown as ToolRouter };
  const skillLoader = new SkillLoader({ repoRoot });
  const skills = skillLoader.initializeSync();
  for (const skill of skills) {
    try {
      registry.register(skillToToolSpec(skill, routerBox));
    } catch (error) {
      const label = skill.metadata?.name || skill.id;
      getLogger().warn(
        `Failed to register skill ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const names = new Set(registry.listAll().map((spec) => spec.name));
  toolNameCache.set(repoRoot, { names, signature });
  return names;
}

export function clearKnownToolNames(repoRoot?: string): void {
  if (repoRoot) {
    toolNameCache.delete(repoRoot);
    return;
  }
  toolNameCache.clear();
}

export function validateSideEffects(raw?: string[]): { valid?: SideEffect[]; invalid?: string[] } {
  if (!raw || raw.length === 0) return {};
  const invalid = raw.filter((effect) => !VALID_SIDE_EFFECTS.has(effect as SideEffect));
  if (invalid.length > 0) return { invalid };
  return { valid: raw as SideEffect[] };
}
