import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { ToolAuthorizationConfig } from '../../core/config/types.js';
import type { SideEffect } from '../../core/tools/types.js';
import type { ExecutionPhase } from '../../core/types.js';

export interface ToolAuthorizationAllowlist {
  version: 1;
  tools: Record<string, ToolAuthorizationAllowlistEntry>;
}

export interface ToolAuthorizationAllowlistEntry {
  mode?: 'allow' | 'deny';
  phases?: Record<string, 'allow' | 'deny'>;
  rules?: ToolAuthorizationRule[];
}

export interface ToolAuthorizationRule {
  mode: 'allow' | 'deny';
  phase?: ExecutionPhase;
  sideEffects?: SideEffect[];
  argsHash?: string;
}

export interface AllowlistMatchContext {
  toolName: string;
  phase: ExecutionPhase;
  sideEffects?: SideEffect[];
  argsHash?: string;
}

const createEmptyAllowlist = (): ToolAuthorizationAllowlist => ({ version: 1, tools: {} });
const CACHE_VERSION = 1;

interface AllowlistCacheFile {
  version: number;
  sourcePath: string;
  sourceMtimeMs: number;
  data: ToolAuthorizationAllowlist;
}

function expandHome(filePath: string): string {
  if (!filePath.startsWith('~')) return filePath;
  return path.join(os.homedir(), filePath.slice(1));
}

function resolveAllowlistPath(filePath: string, repoRoot: string): string {
  const expanded = expandHome(filePath);
  if (expanded.startsWith(path.sep)) return expanded;
  return path.resolve(repoRoot, expanded);
}

function getCachePath(filePath: string, repoRoot: string): string {
  const expanded = resolveAllowlistPath(filePath, repoRoot);
  if (expanded.includes(path.join(repoRoot, '.salmonloop'))) {
    return path.resolve(repoRoot, '.salmonloop', 'state', 'allowlist-cache.json');
  }
  if (expanded.startsWith(os.homedir())) {
    return path.join(os.homedir(), '.salmonloop', 'allowlist-cache.json');
  }
  return path.resolve(repoRoot, '.salmonloop', 'state', 'allowlist-cache.json');
}

async function loadAllowlistCache(
  cachePath: string,
  sourcePath: string,
  sourceMtimeMs: number,
): Promise<ToolAuthorizationAllowlist | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as AllowlistCacheFile;
    if (
      parsed &&
      parsed.version === CACHE_VERSION &&
      parsed.sourcePath === sourcePath &&
      parsed.sourceMtimeMs === sourceMtimeMs &&
      parsed.data?.tools
    ) {
      return parsed.data;
    }
    return null;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    return null;
  }
}

async function saveAllowlistCache(
  cachePath: string,
  sourcePath: string,
  sourceMtimeMs: number,
  data: ToolAuthorizationAllowlist,
): Promise<void> {
  const payload: AllowlistCacheFile = {
    version: CACHE_VERSION,
    sourcePath,
    sourceMtimeMs,
    data,
  };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2));
}

async function loadAllowlist(
  filePath: string,
  repoRoot: string,
  cachePath: string,
): Promise<ToolAuthorizationAllowlist> {
  const resolved = resolveAllowlistPath(filePath, repoRoot);
  try {
    const stat = await fs.stat(resolved);
    const cached = await loadAllowlistCache(cachePath, resolved, stat.mtimeMs);
    if (cached) return cached;

    const raw = await fs.readFile(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.tools && typeof parsed.tools === 'object') {
      const allowlist = { version: 1, tools: parsed.tools } as ToolAuthorizationAllowlist;
      await saveAllowlistCache(cachePath, resolved, stat.mtimeMs, allowlist);
      return allowlist;
    }
    return createEmptyAllowlist();
  } catch (error: any) {
    if (error?.code === 'ENOENT') return createEmptyAllowlist();
    return createEmptyAllowlist();
  }
}

async function saveAllowlist(
  filePath: string,
  repoRoot: string,
  allowlist: ToolAuthorizationAllowlist,
): Promise<void> {
  const resolved = resolveAllowlistPath(filePath, repoRoot);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, JSON.stringify(allowlist, null, 2));
}

function ruleMatches(rule: ToolAuthorizationRule, ctx: AllowlistMatchContext): boolean {
  if (rule.phase && rule.phase !== ctx.phase) return false;
  if (rule.sideEffects && rule.sideEffects.length > 0) {
    if (!ctx.sideEffects || ctx.sideEffects.length === 0) return false;
    for (const effect of rule.sideEffects) {
      if (!ctx.sideEffects.includes(effect)) return false;
    }
  }
  if (rule.argsHash && rule.argsHash !== ctx.argsHash) return false;
  return true;
}

function matchEntry(entry: ToolAuthorizationAllowlistEntry, ctx: AllowlistMatchContext) {
  if (entry.rules && entry.rules.length > 0) {
    for (const rule of entry.rules) {
      if (ruleMatches(rule, ctx) && rule.mode === 'deny') return 'deny';
    }
    for (const rule of entry.rules) {
      if (ruleMatches(rule, ctx) && rule.mode === 'allow') return 'allow';
    }
  }

  if (entry.phases && entry.phases[ctx.phase]) return entry.phases[ctx.phase];
  if (entry.mode) return entry.mode;
  return null;
}

function isAllowed(allowlist: ToolAuthorizationAllowlist, ctx: AllowlistMatchContext) {
  const entry = allowlist.tools[ctx.toolName];
  if (!entry) return null;
  return matchEntry(entry, ctx);
}

export async function loadAllowlistDecision(params: {
  config: ToolAuthorizationConfig;
  repoRoot: string;
  toolName: string;
  phase: ExecutionPhase;
  sideEffects?: SideEffect[];
  argsHash?: string;
}): Promise<'allow' | 'deny' | null> {
  const { config, repoRoot, toolName, phase, sideEffects, argsHash } = params;
  const repoFile = config.allowlist?.repoFile;
  const userFile = config.allowlist?.userFile;
  const ctx: AllowlistMatchContext = { toolName, phase, sideEffects, argsHash };

  if (repoFile) {
    const repoAllowlist = await loadAllowlist(repoFile, repoRoot, getCachePath(repoFile, repoRoot));
    const decision = isAllowed(repoAllowlist, ctx);
    if (decision) return decision;
  }

  if (userFile) {
    const userAllowlist = await loadAllowlist(userFile, repoRoot, getCachePath(userFile, repoRoot));
    const decision = isAllowed(userAllowlist, ctx);
    if (decision) return decision;
  }

  return null;
}

export async function persistAllowlistDecision(params: {
  config: ToolAuthorizationConfig;
  repoRoot: string;
  toolName: string;
  phase: ExecutionPhase;
  scope: 'repo' | 'user';
  mode?: 'allow' | 'deny';
  sideEffects?: SideEffect[];
  argsHash?: string;
}): Promise<void> {
  const {
    config,
    repoRoot,
    toolName,
    phase,
    scope,
    mode = 'allow',
    sideEffects,
    argsHash,
  } = params;
  const targetFile = scope === 'repo' ? config.allowlist?.repoFile : config.allowlist?.userFile;
  if (!targetFile) return;

  const cachePath = getCachePath(targetFile, repoRoot);
  const allowlist = await loadAllowlist(targetFile, repoRoot, cachePath);
  const entry = allowlist.tools[toolName] || { phases: {}, rules: [] };
  const rules = entry.rules || [];
  rules.push({
    mode,
    phase,
    sideEffects: sideEffects && sideEffects.length > 0 ? sideEffects : undefined,
    argsHash,
  });
  allowlist.tools[toolName] = { ...entry, rules };

  await saveAllowlist(targetFile, repoRoot, allowlist);
  const resolved = resolveAllowlistPath(targetFile, repoRoot);
  const stat = await fs.stat(resolved);
  await saveAllowlistCache(cachePath, resolved, stat.mtimeMs, allowlist);
}

export async function listAllowlist(params: {
  config: ToolAuthorizationConfig;
  repoRoot: string;
  scope: 'repo' | 'user';
}): Promise<ToolAuthorizationAllowlist> {
  const { config, repoRoot, scope } = params;
  const targetFile = scope === 'repo' ? config.allowlist?.repoFile : config.allowlist?.userFile;
  if (!targetFile) return createEmptyAllowlist();
  return loadAllowlist(targetFile, repoRoot, getCachePath(targetFile, repoRoot));
}

export async function removeAllowlistRule(params: {
  config: ToolAuthorizationConfig;
  repoRoot: string;
  scope: 'repo' | 'user';
  toolName: string;
  phase?: ExecutionPhase;
  argsHash?: string;
  sideEffects?: SideEffect[];
}): Promise<boolean> {
  const { config, repoRoot, scope, toolName, phase, argsHash, sideEffects } = params;
  const targetFile = scope === 'repo' ? config.allowlist?.repoFile : config.allowlist?.userFile;
  if (!targetFile) return false;

  const cachePath = getCachePath(targetFile, repoRoot);
  const allowlist = await loadAllowlist(targetFile, repoRoot, cachePath);
  const entry = allowlist.tools[toolName];
  if (!entry) return false;

  if (!phase && !argsHash && (!sideEffects || sideEffects.length === 0)) {
    delete allowlist.tools[toolName];
  } else {
    const rules = (entry.rules || []).filter((rule) => {
      if (phase && rule.phase !== phase) return true;
      if (argsHash && rule.argsHash !== argsHash) return true;
      if (sideEffects && sideEffects.length > 0) {
        if (!rule.sideEffects || rule.sideEffects.length === 0) return true;
        for (const effect of sideEffects) {
          if (!rule.sideEffects.includes(effect)) return true;
        }
      }
      return false;
    });
    const hasPhases = entry.phases && Object.keys(entry.phases).length > 0;
    if (rules.length === 0 && !entry.mode && !hasPhases) {
      delete allowlist.tools[toolName];
    } else {
      allowlist.tools[toolName] = { ...entry, rules };
    }
  }

  await saveAllowlist(targetFile, repoRoot, allowlist);
  const resolved = resolveAllowlistPath(targetFile, repoRoot);
  const stat = await fs.stat(resolved);
  await saveAllowlistCache(cachePath, resolved, stat.mtimeMs, allowlist);
  return true;
}

export async function clearAllowlist(params: {
  config: ToolAuthorizationConfig;
  repoRoot: string;
  scope: 'repo' | 'user';
}): Promise<void> {
  const { config, repoRoot, scope } = params;
  const targetFile = scope === 'repo' ? config.allowlist?.repoFile : config.allowlist?.userFile;
  if (!targetFile) return;
  await saveAllowlist(targetFile, repoRoot, createEmptyAllowlist());
  const resolved = resolveAllowlistPath(targetFile, repoRoot);
  const stat = await fs.stat(resolved);
  await saveAllowlistCache(getCachePath(targetFile, repoRoot), resolved, stat.mtimeMs, {
    ...createEmptyAllowlist(),
  });
}

export async function clearAllowlistCache(params: {
  config: ToolAuthorizationConfig;
  repoRoot: string;
}): Promise<void> {
  const { config, repoRoot } = params;
  const targets = [
    config.allowlist?.repoFile ? getCachePath(config.allowlist.repoFile, repoRoot) : undefined,
    config.allowlist?.userFile ? getCachePath(config.allowlist.userFile, repoRoot) : undefined,
  ].filter(Boolean) as string[];

  await Promise.all(
    targets.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }),
  );
}
