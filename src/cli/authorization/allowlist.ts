import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { ToolAuthorizationConfig } from '../../core/config/types.js';
import { LIMITS } from '../../core/limits.js';
import { logger } from '../../core/logger.js';
import type { SideEffect } from '../../core/tools/types.js';
import type { ExecutionPhase } from '../../core/types.js';
import { text } from '../locales/index.js';

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
const CACHE_VERSION = 3;

interface AllowlistCacheFile {
  version: number;
  sourcePath: string;
  sourceMtimeMs: number;
  sourceSize: number;
  sourceHash: string;
  data: ToolAuthorizationAllowlist;
}

function expandHome(filePath: string): string {
  if (!filePath.startsWith('~')) return filePath;
  return path.join(os.homedir(), filePath.slice(1));
}

function resolveAllowlistPath(filePath: string, repoRoot: string, scope: 'repo' | 'user'): string {
  const expanded = expandHome(filePath);
  if (expanded.startsWith(path.sep)) return expanded;
  const baseRoot = scope === 'user' ? os.homedir() : repoRoot;
  return path.resolve(baseRoot, expanded);
}

function resolveAllowlistScopeRoot(repoRoot: string, scope: 'repo' | 'user'): string {
  return scope === 'user'
    ? path.join(os.homedir(), '.salmonloop')
    : path.join(repoRoot, '.salmonloop');
}

function logBlockedAllowlistPath(filePath: string, scope: 'repo' | 'user'): void {
  logger.warn(text.cli.authPathBlocked(filePath, scope));
  logger.audit(
    'ALLOWLIST_PATH_BLOCKED',
    { path: filePath, scope },
    { source: 'allowlist', severity: 'high', scope },
  );
}

function ensureAllowlistPath(
  filePath: string,
  repoRoot: string,
  scope: 'repo' | 'user',
): string | null {
  const resolved = resolveAllowlistPath(filePath, repoRoot, scope);
  const scopeRoot = resolveAllowlistScopeRoot(repoRoot, scope);
  const normalizedResolved = path.resolve(resolved);
  const normalizedRoot = path.resolve(scopeRoot);
  if (normalizedResolved === normalizedRoot) return null;
  if (!normalizedResolved.startsWith(normalizedRoot + path.sep)) return null;
  return normalizedResolved;
}

function hashCacheKey(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getCachePath(resolvedPath: string, repoRoot: string): string {
  const cacheName = `allowlist-cache-${hashCacheKey(resolvedPath)}.json`;
  if (resolvedPath.includes(path.join(repoRoot, '.salmonloop'))) {
    return path.resolve(repoRoot, '.salmonloop', 'state', cacheName);
  }
  if (resolvedPath.startsWith(os.homedir())) {
    return path.join(os.homedir(), '.salmonloop', cacheName);
  }
  return path.resolve(repoRoot, '.salmonloop', 'state', cacheName);
}

async function readAllowlistCache(cachePath: string): Promise<AllowlistCacheFile | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as AllowlistCacheFile;
    return parsed;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    return null;
  }
}

async function saveAllowlistCache(
  cachePath: string,
  sourcePath: string,
  sourceMtimeMs: number,
  sourceSize: number,
  sourceHash: string,
  data: ToolAuthorizationAllowlist,
): Promise<void> {
  const payload: AllowlistCacheFile = {
    version: CACHE_VERSION,
    sourcePath,
    sourceMtimeMs,
    sourceSize,
    sourceHash,
    data,
  };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2));
}

function hashAllowlistSource(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getCacheInvalidationReason(
  cached: AllowlistCacheFile,
  sourcePath: string,
  sourceMtimeMs: number,
  sourceSize: number,
  sourceHash?: string,
): string | null {
  if (cached.version !== CACHE_VERSION) return 'version_mismatch';
  if (cached.sourcePath !== sourcePath) return 'source_path_mismatch';
  if (cached.sourceMtimeMs !== sourceMtimeMs) return 'mtime_mismatch';
  if (cached.sourceSize !== sourceSize) return 'size_mismatch';
  if (sourceHash && cached.sourceHash !== sourceHash) return 'hash_mismatch';
  if (!cached.data?.tools) return 'missing_tools';
  return null;
}

function resolveAllowlistPathOrLog(
  filePath: string,
  repoRoot: string,
  scope: 'repo' | 'user',
): string | null {
  const resolved = ensureAllowlistPath(filePath, repoRoot, scope);
  if (!resolved) {
    logBlockedAllowlistPath(filePath, scope);
  }
  return resolved;
}

async function loadAllowlist(
  filePath: string,
  repoRoot: string,
  scope: 'repo' | 'user',
): Promise<ToolAuthorizationAllowlist> {
  const resolved = resolveAllowlistPathOrLog(filePath, repoRoot, scope);
  if (!resolved) return createEmptyAllowlist();
  return loadAllowlistResolved(resolved, repoRoot, scope);
}

async function loadAllowlistResolved(
  resolved: string,
  repoRoot: string,
  scope: 'repo' | 'user',
): Promise<ToolAuthorizationAllowlist> {
  const cachePath = getCachePath(resolved, repoRoot);

  try {
    const stat = await fs.stat(resolved);
    const sourceMtimeMs = stat.mtimeMs;
    const sourceSize = stat.size;
    const scopeResolved = scope;

    const cached = await readAllowlistCache(cachePath);
    if (cached) {
      const reason = getCacheInvalidationReason(
        cached,
        resolved,
        sourceMtimeMs,
        sourceSize,
        undefined,
      );
      if (!reason && cached.data?.tools) {
        logger.audit(
          'ALLOWLIST_CACHE_HIT',
          {
            path: resolved,
            hash: cached.sourceHash,
            mtimeMs: sourceMtimeMs,
            size: sourceSize,
          },
          { source: 'allowlist', severity: 'low', scope: scopeResolved },
        );
        return cached.data;
      }
      if (reason) {
        logger.info(text.cli.authCacheInvalidated(reason, resolved));
        logger.audit(
          'ALLOWLIST_CACHE_INVALIDATED',
          {
            path: resolved,
            reason,
            cachedPath: cached.sourcePath,
            cachedHash: cached.sourceHash,
            cachedMtimeMs: cached.sourceMtimeMs,
            cachedSize: cached.sourceSize,
          },
          { source: 'allowlist', severity: 'low', scope: scopeResolved },
        );
      }
    } else {
      logger.audit(
        'ALLOWLIST_CACHE_MISS',
        { path: resolved, cachePath },
        { source: 'allowlist', severity: 'low', scope: scopeResolved },
      );
    }

    const raw = await fs.readFile(resolved, 'utf8');
    const sourceHash = hashAllowlistSource(raw);
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.audit(
        'ALLOWLIST_PARSE_FAILED',
        { path: resolved, error: msg },
        { source: 'allowlist', severity: 'medium', scope: scopeResolved },
      );
      return createEmptyAllowlist();
    }
    if (parsed && parsed.version === 1 && parsed.tools && typeof parsed.tools === 'object') {
      const allowlist = { version: 1, tools: parsed.tools } as ToolAuthorizationAllowlist;
      await saveAllowlistCache(
        cachePath,
        resolved,
        sourceMtimeMs,
        sourceSize,
        sourceHash,
        allowlist,
      );
      return allowlist;
    }
    return createEmptyAllowlist();
  } catch (error: any) {
    if (error?.code === 'ENOENT') return createEmptyAllowlist();
    return createEmptyAllowlist();
  }
}

async function saveAllowlistResolved(
  resolved: string,
  allowlist: ToolAuthorizationAllowlist,
): Promise<void> {
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await writeFileAtomic(resolved, JSON.stringify(allowlist, null, 2));
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

const allowlistLocks = new Map<string, Promise<void>>();
const allowlistLockOwners = new Map<string, string>();
const allowlistLockPrefix = `allowlist-${process.pid}-`;

async function withAllowlistLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = allowlistLocks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  allowlistLocks.set(
    key,
    previous.then(() => next),
  );
  await previous;
  try {
    return await fn();
  } finally {
    release?.();
    if (allowlistLocks.get(key) === next) {
      allowlistLocks.delete(key);
    }
  }
}

function getAllowlistLockPath(resolvedPath: string, repoRoot: string): string {
  const lockName = `allowlist-${hashCacheKey(resolvedPath)}.lock`;
  if (resolvedPath.includes(path.join(repoRoot, '.salmonloop'))) {
    return path.resolve(repoRoot, '.salmonloop', 'state', 'locks', lockName);
  }
  if (resolvedPath.startsWith(os.homedir())) {
    return path.join(os.homedir(), '.salmonloop', 'locks', lockName);
  }
  return path.resolve(repoRoot, '.salmonloop', 'state', 'locks', lockName);
}

function createAllowlistLockOwner(): string {
  const salt = crypto.randomBytes(8).toString('hex');
  return `${allowlistLockPrefix}${salt}`;
}

async function acquireAllowlistFileLock(lockPath: string, scope: 'repo' | 'user'): Promise<void> {
  const start = Date.now();
  let retryCount = 0;
  const owner = createAllowlistLockOwner();

  while (Date.now() - start < LIMITS.lockWaitTimeoutMs) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, timestamp: Date.now(), owner }),
        'utf8',
      );
      await handle.close();
      allowlistLockOwners.set(lockPath, owner);
      return;
    } catch (error: any) {
      if (error?.code === 'EEXIST') {
        try {
          const raw = await fs.readFile(lockPath, 'utf8');
          const metadata = JSON.parse(raw) as { pid?: number; timestamp?: number; owner?: string };
          const age = Date.now() - (metadata.timestamp ?? 0);
          let isAlive = true;
          if (metadata.pid) {
            try {
              process.kill(metadata.pid, 0);
            } catch {
              isAlive = false;
            }
          }
          if (!isAlive || age > LIMITS.lockStaleThresholdMs) {
            await fs.unlink(lockPath).catch(() => undefined);
            continue;
          }
        } catch {
          // If lock contents are unreadable, treat it as stale and retry.
          await fs.unlink(lockPath).catch(() => undefined);
          continue;
        }

        retryCount += 1;
        const delay = Math.min(
          LIMITS.retry.io.initialDelayMs * Math.pow(1.5, retryCount),
          LIMITS.retry.io.maxDelayMs,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (error?.code === 'ENOENT') {
        await fs.mkdir(path.dirname(lockPath), { recursive: true });
        continue;
      }

      throw error;
    }
  }

  logger.audit(
    'ALLOWLIST_LOCK_TIMEOUT',
    { path: lockPath },
    { source: 'allowlist', severity: 'high', scope },
  );
  throw new Error(text.cli.authLockTimeout(lockPath));
}

async function releaseAllowlistFileLock(lockPath: string): Promise<void> {
  const owner = allowlistLockOwners.get(lockPath);
  if (!owner) return;
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const metadata = JSON.parse(raw) as { owner?: string };
    if (metadata.owner !== owner) return;
  } catch {
    // If we cannot read it, still attempt to remove to avoid deadlocks.
  }
  try {
    await fs.unlink(lockPath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  } finally {
    allowlistLockOwners.delete(lockPath);
  }
}

async function withAllowlistFileLock<T>(
  resolvedPath: string,
  repoRoot: string,
  scope: 'repo' | 'user',
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = getAllowlistLockPath(resolvedPath, repoRoot);
  await acquireAllowlistFileLock(lockPath, scope);
  try {
    return await fn();
  } finally {
    await releaseAllowlistFileLock(lockPath);
  }
}

async function writeFileAtomic(targetPath: string, content: string): Promise<void> {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content);
  try {
    await fs.rename(tempPath, targetPath);
  } catch {
    try {
      await fs.writeFile(targetPath, content);
    } finally {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  }
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

  const userDecision = userFile
    ? isAllowed(await loadAllowlist(userFile, repoRoot, 'user'), ctx)
    : null;
  if (userDecision === 'deny') return 'deny';

  const repoDecision = repoFile
    ? isAllowed(await loadAllowlist(repoFile, repoRoot, 'repo'), ctx)
    : null;
  if (repoDecision === 'deny') return 'deny';

  if (userDecision === 'allow') return 'allow';
  if (repoDecision === 'allow') return 'allow';

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

  const resolved = resolveAllowlistPathOrLog(targetFile, repoRoot, scope);
  if (!resolved) return;

  await withAllowlistLock(resolved, async () =>
    withAllowlistFileLock(resolved, repoRoot, scope, async () => {
      const allowlist = await loadAllowlistResolved(resolved, repoRoot, scope);
      const entry = allowlist.tools[toolName] || { phases: {}, rules: [] };
      const rules = entry.rules || [];
      rules.push({
        mode,
        phase,
        sideEffects: sideEffects && sideEffects.length > 0 ? sideEffects : undefined,
        argsHash,
      });
      allowlist.tools[toolName] = { ...entry, rules };

      await saveAllowlistResolved(resolved, allowlist);
      const cachePath = getCachePath(resolved, repoRoot);
      const stat = await fs.stat(resolved);
      const raw = await fs.readFile(resolved, 'utf8');
      await saveAllowlistCache(
        cachePath,
        resolved,
        stat.mtimeMs,
        stat.size,
        hashAllowlistSource(raw),
        allowlist,
      );
    }),
  );
}

export async function listAllowlist(params: {
  config: ToolAuthorizationConfig;
  repoRoot: string;
  scope: 'repo' | 'user';
}): Promise<ToolAuthorizationAllowlist> {
  const { config, repoRoot, scope } = params;
  const targetFile = scope === 'repo' ? config.allowlist?.repoFile : config.allowlist?.userFile;
  if (!targetFile) return createEmptyAllowlist();
  return loadAllowlist(targetFile, repoRoot, scope);
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

  const resolved = resolveAllowlistPathOrLog(targetFile, repoRoot, scope);
  if (!resolved) return false;

  return withAllowlistLock(resolved, async () =>
    withAllowlistFileLock(resolved, repoRoot, scope, async () => {
      const allowlist = await loadAllowlistResolved(resolved, repoRoot, scope);
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

      await saveAllowlistResolved(resolved, allowlist);
      const cachePath = getCachePath(resolved, repoRoot);
      const stat = await fs.stat(resolved);
      const raw = await fs.readFile(resolved, 'utf8');
      await saveAllowlistCache(
        cachePath,
        resolved,
        stat.mtimeMs,
        stat.size,
        hashAllowlistSource(raw),
        allowlist,
      );
      return true;
    }),
  );
}

export async function clearAllowlist(params: {
  config: ToolAuthorizationConfig;
  repoRoot: string;
  scope: 'repo' | 'user';
}): Promise<void> {
  const { config, repoRoot, scope } = params;
  const targetFile = scope === 'repo' ? config.allowlist?.repoFile : config.allowlist?.userFile;
  if (!targetFile) return;
  const resolved = resolveAllowlistPathOrLog(targetFile, repoRoot, scope);
  if (!resolved) return;

  await withAllowlistLock(resolved, async () =>
    withAllowlistFileLock(resolved, repoRoot, scope, async () => {
      const empty = createEmptyAllowlist();
      await saveAllowlistResolved(resolved, empty);
      const stat = await fs.stat(resolved);
      const raw = await fs.readFile(resolved, 'utf8');
      await saveAllowlistCache(
        getCachePath(resolved, repoRoot),
        resolved,
        stat.mtimeMs,
        stat.size,
        hashAllowlistSource(raw),
        {
          ...empty,
        },
      );
    }),
  );
}

export async function clearAllowlistCache(params: {
  config: ToolAuthorizationConfig;
  repoRoot: string;
}): Promise<void> {
  const { config, repoRoot } = params;
  const repoResolved = config.allowlist?.repoFile
    ? resolveAllowlistPathOrLog(config.allowlist.repoFile, repoRoot, 'repo')
    : null;
  const userResolved = config.allowlist?.userFile
    ? resolveAllowlistPathOrLog(config.allowlist.userFile, repoRoot, 'user')
    : null;
  const targets = [
    repoResolved ? getCachePath(repoResolved, repoRoot) : undefined,
    userResolved ? getCachePath(userResolved, repoRoot) : undefined,
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
