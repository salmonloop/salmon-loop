import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

import { LIMITS } from '../../core/config/limits.js';
import type { ToolAuthorizationConfig } from '../../core/config/types.js';
import { logger } from '../../core/observability/logger.js';
import type { SideEffect } from '../../core/tools/types.js';
import type { ExecutionPhase } from '../../core/types/execution.js';
import { text } from '../locales/index.js';
import {
  copyFile,
  mkdirp,
  openFile,
  readdir,
  readFileUtf8,
  realpath,
  rename,
  stat,
  unlink,
  writeFileUtf8,
} from '../utils/safe-fs.js';

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

type AllowlistLoadOutcome = 'success' | 'failure';
type AllowlistLoadSource = 'cache' | 'file' | 'missing' | 'empty' | 'parse' | 'blocked' | 'read';

interface AllowlistLoadStats {
  total: number;
  success: number;
  failure: number;
}

interface AllowlistLoadToolStats {
  total: number;
  success: number;
  failure: number;
}

const allowlistLoadStats: Record<'repo' | 'user', AllowlistLoadStats> = {
  repo: { total: 0, success: 0, failure: 0 },
  user: { total: 0, success: 0, failure: 0 },
};
const allowlistLoadToolCounts: Record<'repo' | 'user', Map<string, number>> = {
  repo: new Map(),
  user: new Map(),
};
const allowlistLoadToolStats: Record<'repo' | 'user', Map<string, AllowlistLoadToolStats>> = {
  repo: new Map(),
  user: new Map(),
};
const allowlistLoadPathCounts: Record<'repo' | 'user', Map<string, number>> = {
  repo: new Map(),
  user: new Map(),
};
const allowlistLoadSummaryState: Record<
  'repo' | 'user',
  { lastLoggedAt: number; lastLoggedTotal: number; lastLoggedFailure: number }
> = {
  repo: { lastLoggedAt: 0, lastLoggedTotal: 0, lastLoggedFailure: 0 },
  user: { lastLoggedAt: 0, lastLoggedTotal: 0, lastLoggedFailure: 0 },
};

const DEFAULT_ALLOWLIST_SUMMARY_CONFIG = {
  every: 100,
  minIntervalMs: 10 * 60 * 1000,
  failureMinIntervalMs: 60 * 1000,
  maxToolStats: 1000,
  maxPathStats: 2000,
};

let allowlistSummaryConfig = { ...DEFAULT_ALLOWLIST_SUMMARY_CONFIG };
const MAX_REALPATH_ASCENT = 20;
const TEMP_ARTIFACT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const cleanedAllowlistDirs = new Set<string>();

type AllowlistSideEffectMatch = 'any' | 'all';

const DEFAULT_ALLOWLIST_MATCHING_CONFIG: {
  denySideEffects: AllowlistSideEffectMatch;
  allowSideEffects: AllowlistSideEffectMatch;
} = {
  denySideEffects: 'any',
  allowSideEffects: 'all',
};

let allowlistMatchingConfig: {
  denySideEffects: AllowlistSideEffectMatch;
  allowSideEffects: AllowlistSideEffectMatch;
} = { ...DEFAULT_ALLOWLIST_MATCHING_CONFIG };

function normalizeConfigNumber(value: unknown, fallback: number, min: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) return fallback;
  return Math.floor(value);
}

function applyAllowlistSummaryConfig(config?: ToolAuthorizationConfig): void {
  const summary = config?.allowlist?.summary;
  allowlistSummaryConfig = {
    every: normalizeConfigNumber(summary?.every, DEFAULT_ALLOWLIST_SUMMARY_CONFIG.every, 1),
    minIntervalMs: normalizeConfigNumber(
      summary?.minIntervalMs,
      DEFAULT_ALLOWLIST_SUMMARY_CONFIG.minIntervalMs,
      0,
    ),
    failureMinIntervalMs: normalizeConfigNumber(
      summary?.failureMinIntervalMs,
      DEFAULT_ALLOWLIST_SUMMARY_CONFIG.failureMinIntervalMs,
      0,
    ),
    maxToolStats: normalizeConfigNumber(
      summary?.maxToolStats,
      DEFAULT_ALLOWLIST_SUMMARY_CONFIG.maxToolStats,
      1,
    ),
    maxPathStats: normalizeConfigNumber(
      summary?.maxPathStats,
      DEFAULT_ALLOWLIST_SUMMARY_CONFIG.maxPathStats,
      1,
    ),
  };
}

function applyAllowlistMatchingConfig(config?: ToolAuthorizationConfig): void {
  const matching = config?.allowlist?.matching;
  const denySideEffects =
    matching?.denySideEffects === 'all' || matching?.denySideEffects === 'any'
      ? matching.denySideEffects
      : DEFAULT_ALLOWLIST_MATCHING_CONFIG.denySideEffects;
  const allowSideEffects =
    matching?.allowSideEffects === 'all' || matching?.allowSideEffects === 'any'
      ? matching.allowSideEffects
      : DEFAULT_ALLOWLIST_MATCHING_CONFIG.allowSideEffects;
  allowlistMatchingConfig = {
    denySideEffects,
    allowSideEffects,
  };
}

async function cleanupAllowlistArtifacts(
  targetPath: string,
  rootContext: string,
  scope: 'repo' | 'user',
): Promise<void> {
  const dir = path.dirname(targetPath);
  if (cleanedAllowlistDirs.has(dir)) return;
  cleanedAllowlistDirs.add(dir);

  try {
    const entries = await readdir(dir, rootContext);
    const now = Date.now();
    const base = path.basename(targetPath);
    let cleaned = 0;

    for (const entry of entries) {
      if (!entry.startsWith(`${base}.`)) continue;
      if (!entry.endsWith('.tmp') && !entry.endsWith('.bak')) continue;
      const fullPath = path.join(dir, entry);
      try {
        const fileStat = await stat(fullPath, rootContext);
        if (now - fileStat.mtimeMs < TEMP_ARTIFACT_MAX_AGE_MS) continue;
        await unlink(fullPath, rootContext);
        cleaned += 1;
      } catch {
        // Best effort cleanup
      }
    }

    if (cleaned > 0) {
      logger.audit(
        'ALLOWLIST_TEMP_ARTIFACTS_CLEANED',
        { path: dir, count: cleaned },
        { source: 'allowlist', severity: 'low', scope },
      );
    }
  } catch {
    // Best effort cleanup
  }
}

function updateCountMap(map: Map<string, number>, key: string, limit: number): number {
  const next = (map.get(key) ?? 0) + 1;
  map.set(key, next);
  map.delete(key);
  map.set(key, next);
  if (map.size > limit) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
  return next;
}

function updateToolStatsMap(
  map: Map<string, AllowlistLoadToolStats>,
  key: string,
  outcome: AllowlistLoadOutcome,
): AllowlistLoadToolStats {
  const current = map.get(key) ?? { total: 0, success: 0, failure: 0 };
  current.total += 1;
  if (outcome === 'success') {
    current.success += 1;
  } else {
    current.failure += 1;
  }
  map.set(key, current);
  map.delete(key);
  map.set(key, current);
  if (map.size > allowlistSummaryConfig.maxToolStats) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
  return current;
}

function shouldLogAllowlistSummary(scope: 'repo' | 'user', outcome: AllowlistLoadOutcome): boolean {
  const state = allowlistLoadSummaryState[scope];
  const stats = allowlistLoadStats[scope];
  const { every, minIntervalMs, failureMinIntervalMs } = allowlistSummaryConfig;
  const now = Date.now();
  const totalDelta = stats.total - state.lastLoggedTotal;
  const failureDelta = stats.failure - state.lastLoggedFailure;
  if (totalDelta >= every) return true;
  if (now - state.lastLoggedAt >= minIntervalMs) return true;
  if (
    outcome === 'failure' &&
    failureDelta > 0 &&
    now - state.lastLoggedAt >= failureMinIntervalMs
  ) {
    return true;
  }
  return false;
}

function recordAllowlistLoadSummary(params: {
  scope: 'repo' | 'user';
  outcome: AllowlistLoadOutcome;
  source: AllowlistLoadSource;
  error?: string;
  toolName?: string;
  path?: string;
}): void {
  const { scope, outcome, source, error, toolName, path } = params;
  const stats = allowlistLoadStats[scope];
  stats.total += 1;
  if (outcome === 'success') {
    stats.success += 1;
  } else {
    stats.failure += 1;
  }
  if (!shouldLogAllowlistSummary(scope, outcome)) {
    if (toolName) {
      updateCountMap(allowlistLoadToolCounts[scope], toolName, allowlistSummaryConfig.maxToolStats);
      updateToolStatsMap(allowlistLoadToolStats[scope], toolName, outcome);
    }
    if (path) {
      updateCountMap(allowlistLoadPathCounts[scope], path, allowlistSummaryConfig.maxPathStats);
    }
    return;
  }
  const summaryState = allowlistLoadSummaryState[scope];
  if (toolName) {
    updateCountMap(allowlistLoadToolCounts[scope], toolName, allowlistSummaryConfig.maxToolStats);
  }
  if (path) {
    updateCountMap(allowlistLoadPathCounts[scope], path, allowlistSummaryConfig.maxPathStats);
  }
  const toolStats = toolName
    ? updateToolStatsMap(allowlistLoadToolStats[scope], toolName, outcome)
    : undefined;
  const toolFailureRate = toolStats
    ? Math.round((toolStats.failure / toolStats.total) * 10000) / 100
    : undefined;
  summaryState.lastLoggedAt = Date.now();
  summaryState.lastLoggedTotal = stats.total;
  summaryState.lastLoggedFailure = stats.failure;
  logger.audit(
    'ALLOWLIST_LOAD_SUMMARY',
    {
      scope,
      total: stats.total,
      success: stats.success,
      failure: stats.failure,
      lastOutcome: outcome,
      lastSource: source,
      lastError: error,
      lastToolName: toolName,
      lastPath: path,
      toolCount: toolName ? allowlistLoadToolCounts[scope].get(toolName) : undefined,
      pathCount: path ? allowlistLoadPathCounts[scope].get(path) : undefined,
      toolFailureRatePct: toolFailureRate,
    },
    { source: 'allowlist', severity: 'low', scope },
  );
}

function expandHome(filePath: string): string {
  if (!filePath.startsWith('~')) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
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

async function resolveRealTargetForMissingPath(targetPath: string): Promise<string | null> {
  let current = targetPath;
  let depth = 0;
  while (depth < MAX_REALPATH_ASCENT) {
    try {
      const realParent = await realpath(current);
      const relative = path.relative(current, targetPath);
      return path.join(realParent, relative);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT')
        return null;
    }
    const next = path.dirname(current);
    if (next === current) return null;
    current = next;
    depth += 1;
  }
  return null;
}

function logBlockedAllowlistPath(filePath: string, scope: 'repo' | 'user'): void {
  logger.warn(text.cli.authPathBlocked(filePath, scope));
  logger.audit(
    'ALLOWLIST_PATH_BLOCKED',
    { path: filePath, scope },
    { source: 'allowlist', severity: 'high', scope },
  );
}

async function ensureAllowlistPath(
  filePath: string,
  repoRoot: string,
  scope: 'repo' | 'user',
): Promise<string | null> {
  const resolved = resolveAllowlistPath(filePath, repoRoot, scope);
  const scopeRoot = resolveAllowlistScopeRoot(repoRoot, scope);
  const normalizedResolved = path.resolve(resolved);
  const normalizedRoot = path.resolve(scopeRoot);
  if (normalizedResolved === normalizedRoot) return null;
  if (!normalizedResolved.startsWith(normalizedRoot + path.sep)) return null;

  let realRoot: string;
  try {
    realRoot = await realpath(normalizedRoot, normalizedRoot);
  } catch {
    realRoot = normalizedRoot;
  }

  let realTarget: string;
  try {
    realTarget = await realpath(normalizedResolved, normalizedRoot);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      const resolvedTarget = await resolveRealTargetForMissingPath(normalizedResolved);
      if (!resolvedTarget) return null;
      realTarget = resolvedTarget;
    } else {
      return null;
    }
  }

  const realRootNormalized = path.resolve(realRoot);
  const realTargetNormalized = path.resolve(realTarget);
  if (realTargetNormalized === realRootNormalized) return null;
  if (!realTargetNormalized.startsWith(realRootNormalized + path.sep)) return null;
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

async function readAllowlistCache(
  cachePath: string,
  rootContext: string,
): Promise<AllowlistCacheFile | null> {
  try {
    const raw = await readFileUtf8(cachePath, rootContext);
    const parsed = JSON.parse(raw) as AllowlistCacheFile;
    return parsed;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return null;
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
  rootContext: string,
): Promise<void> {
  const payload: AllowlistCacheFile = {
    version: CACHE_VERSION,
    sourcePath,
    sourceMtimeMs,
    sourceSize,
    sourceHash,
    data,
  };
  await mkdirp(path.dirname(cachePath), rootContext);
  await writeFileUtf8(cachePath, JSON.stringify(payload, null, 2), rootContext);
}

async function saveAllowlistCacheWithAudit(
  cachePath: string,
  sourcePath: string,
  sourceMtimeMs: number,
  sourceSize: number,
  sourceHash: string,
  data: ToolAuthorizationAllowlist,
  rootContext: string,
  scope: 'repo' | 'user',
): Promise<void> {
  try {
    await saveAllowlistCache(
      cachePath,
      sourcePath,
      sourceMtimeMs,
      sourceSize,
      sourceHash,
      data,
      rootContext,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.audit(
      'ALLOWLIST_CACHE_WRITE_FAILED',
      { path: cachePath, sourcePath, error: msg },
      { source: 'allowlist', severity: 'high', scope },
    );
    throw error;
  }
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

async function resolveAllowlistPathOrLog(
  filePath: string,
  repoRoot: string,
  scope: 'repo' | 'user',
): Promise<string | null> {
  const resolved = await ensureAllowlistPath(filePath, repoRoot, scope);
  if (!resolved) {
    logBlockedAllowlistPath(filePath, scope);
  }
  return resolved;
}

async function loadAllowlist(
  filePath: string,
  repoRoot: string,
  scope: 'repo' | 'user',
  toolName?: string,
): Promise<ToolAuthorizationAllowlist> {
  const resolved = await resolveAllowlistPathOrLog(filePath, repoRoot, scope);
  if (!resolved) {
    recordAllowlistLoadSummary({
      scope,
      outcome: 'failure',
      source: 'blocked',
      toolName,
      path: filePath,
    });
    return createEmptyAllowlist();
  }
  return loadAllowlistResolved(resolved, repoRoot, scope, toolName);
}

async function loadAllowlistResolved(
  resolved: string,
  repoRoot: string,
  scope: 'repo' | 'user',
  toolName?: string,
): Promise<ToolAuthorizationAllowlist> {
  const scopeRoot = resolveAllowlistScopeRoot(repoRoot, scope);
  const cachePath = getCachePath(resolved, repoRoot);

  try {
    const sourceStat = await stat(resolved, scopeRoot);
    const sourceMtimeMs = sourceStat.mtimeMs;
    const sourceSize = sourceStat.size;
    const scopeResolved = scope;

    const cached = await readAllowlistCache(cachePath, scopeRoot);
    if (cached) {
      const reason = getCacheInvalidationReason(
        cached,
        resolved,
        sourceMtimeMs,
        sourceSize,
        undefined,
      );
      if (!reason && cached.data?.tools) {
        recordAllowlistLoadSummary({
          scope: scopeResolved,
          outcome: 'success',
          source: 'cache',
          toolName,
          path: resolved,
        });
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

    const raw = await readFileUtf8(resolved, scopeRoot);
    const sourceHash = hashAllowlistSource(raw);
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      recordAllowlistLoadSummary({
        scope: scopeResolved,
        outcome: 'failure',
        source: 'parse',
        error: msg,
        toolName,
        path: resolved,
      });
      logger.audit(
        'ALLOWLIST_PARSE_FAILED',
        { path: resolved, error: msg },
        { source: 'allowlist', severity: 'medium', scope: scopeResolved },
      );
      return createEmptyAllowlist();
    }
    if (parsed && parsed.version === 1 && parsed.tools && typeof parsed.tools === 'object') {
      const allowlist = { version: 1, tools: parsed.tools } as ToolAuthorizationAllowlist;
      await saveAllowlistCacheWithAudit(
        cachePath,
        resolved,
        sourceMtimeMs,
        sourceSize,
        sourceHash,
        allowlist,
        scopeRoot,
        scopeResolved,
      );
      recordAllowlistLoadSummary({
        scope: scopeResolved,
        outcome: 'success',
        source: 'file',
        toolName,
        path: resolved,
      });
      return allowlist;
    }
    recordAllowlistLoadSummary({
      scope: scopeResolved,
      outcome: 'success',
      source: 'empty',
      toolName,
      path: resolved,
    });
    return createEmptyAllowlist();
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      recordAllowlistLoadSummary({
        scope,
        outcome: 'success',
        source: 'missing',
        toolName,
        path: resolved,
      });
      return createEmptyAllowlist();
    }
    const msg = error instanceof Error ? error.message : String(error);
    recordAllowlistLoadSummary({
      scope,
      outcome: 'failure',
      source: 'read',
      error: msg,
      toolName,
      path: resolved,
    });
    return createEmptyAllowlist();
  }
}

async function saveAllowlistResolved(
  resolved: string,
  allowlist: ToolAuthorizationAllowlist,
  repoRoot: string,
  scope: 'repo' | 'user',
): Promise<void> {
  const scopeRoot = resolveAllowlistScopeRoot(repoRoot, scope);
  try {
    await mkdirp(path.dirname(resolved), scopeRoot);
    await writeFileAtomic(resolved, JSON.stringify(allowlist, null, 2), scopeRoot, scope);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.audit(
      'ALLOWLIST_WRITE_FAILED',
      { path: resolved, error: msg },
      { source: 'allowlist', severity: 'high', scope },
    );
    throw error;
  }
}

function ruleMatches(
  rule: ToolAuthorizationRule,
  ctx: AllowlistMatchContext,
  sideEffectMode: 'all' | 'any',
): boolean {
  if (rule.phase && rule.phase !== ctx.phase) return false;
  if (rule.sideEffects && rule.sideEffects.length > 0) {
    if (!ctx.sideEffects || ctx.sideEffects.length === 0) return false;
    if (sideEffectMode === 'any') {
      const matches = rule.sideEffects.some((effect) => ctx.sideEffects?.includes(effect));
      if (!matches) return false;
    } else {
      for (const effect of rule.sideEffects) {
        if (!ctx.sideEffects.includes(effect)) return false;
      }
    }
  }
  if (rule.argsHash && rule.argsHash !== ctx.argsHash) return false;
  return true;
}

function matchEntry(entry: ToolAuthorizationAllowlistEntry, ctx: AllowlistMatchContext) {
  if (entry.rules && entry.rules.length > 0) {
    for (const rule of entry.rules) {
      if (ruleMatches(rule, ctx, allowlistMatchingConfig.denySideEffects) && rule.mode === 'deny')
        return 'deny';
    }
    for (const rule of entry.rules) {
      if (
        ruleMatches(rule, ctx, allowlistMatchingConfig.allowSideEffects) &&
        rule.mode === 'allow'
      ) {
        return 'allow';
      }
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

async function acquireAllowlistFileLock(
  lockPath: string,
  rootContext: string,
  scope: 'repo' | 'user',
): Promise<void> {
  const start = Date.now();
  let retryCount = 0;
  const owner = createAllowlistLockOwner();
  const verifyDelayMs = 25;

  while (Date.now() - start < LIMITS.lockWaitTimeoutMs) {
    try {
      const handle = await openFile(lockPath, 'wx', rootContext);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, timestamp: Date.now(), owner }),
        'utf8',
      );
      await handle.close();
      try {
        const raw = await readFileUtf8(lockPath, rootContext);
        const metadata = JSON.parse(raw) as { owner?: string; pid?: number };
        if (metadata.owner !== owner) {
          await new Promise((resolve) => setTimeout(resolve, verifyDelayMs));
          const retryRaw = await readFileUtf8(lockPath, rootContext);
          const retryMetadata = JSON.parse(retryRaw) as { owner?: string; pid?: number };
          if (retryMetadata.owner !== owner) {
            logger.audit(
              'ALLOWLIST_LOCK_VERIFICATION_FAILED',
              { path: lockPath, owner, pid: process.pid },
              { source: 'allowlist', severity: 'medium', scope },
            );
            await unlink(lockPath, rootContext).catch(() => undefined);
            retryCount += 1;
            const delay = Math.min(
              LIMITS.retry.io.initialDelayMs * Math.pow(1.5, retryCount),
              LIMITS.retry.io.maxDelayMs,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }
      } catch {
        logger.audit(
          'ALLOWLIST_LOCK_VERIFICATION_FAILED',
          { path: lockPath, owner, pid: process.pid },
          { source: 'allowlist', severity: 'medium', scope },
        );
        await unlink(lockPath, rootContext).catch(() => undefined);
        retryCount += 1;
        const delay = Math.min(
          LIMITS.retry.io.initialDelayMs * Math.pow(1.5, retryCount),
          LIMITS.retry.io.maxDelayMs,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      allowlistLockOwners.set(lockPath, owner);
      logger.audit(
        'ALLOWLIST_LOCK_ACQUIRED',
        { path: lockPath, owner, pid: process.pid, waitedMs: Date.now() - start },
        { source: 'allowlist', severity: 'low', scope },
      );
      return;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        try {
          const raw = await readFileUtf8(lockPath, rootContext);
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
            await unlink(lockPath, rootContext).catch(() => undefined);
            logger.audit(
              'ALLOWLIST_LOCK_STALE_REMOVED',
              { path: lockPath, owner: metadata.owner, pid: metadata.pid, ageMs: age },
              { source: 'allowlist', severity: 'medium', scope },
            );
            continue;
          }
        } catch {
          // If lock contents are unreadable, treat it as stale and retry.
          await unlink(lockPath, rootContext).catch(() => undefined);
          logger.audit(
            'ALLOWLIST_LOCK_STALE_REMOVED',
            { path: lockPath, owner: 'unknown', pid: undefined, ageMs: undefined },
            { source: 'allowlist', severity: 'medium', scope },
          );
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

      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        await mkdirp(path.dirname(lockPath), rootContext);
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

async function releaseAllowlistFileLock(
  lockPath: string,
  rootContext: string,
  scope: 'repo' | 'user',
): Promise<void> {
  const owner = allowlistLockOwners.get(lockPath);
  if (!owner) return;
  try {
    const raw = await readFileUtf8(lockPath, rootContext);
    const metadata = JSON.parse(raw) as { owner?: string };
    if (metadata.owner !== owner) return;
  } catch {
    // If we cannot read it, still attempt to remove to avoid deadlocks.
  }
  try {
    await unlink(lockPath, rootContext);
    logger.audit(
      'ALLOWLIST_LOCK_RELEASED',
      { path: lockPath, owner, pid: process.pid },
      { source: 'allowlist', severity: 'low', scope },
    );
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT')
      throw error;
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
  const rootContext = resolveAllowlistScopeRoot(repoRoot, scope);
  await acquireAllowlistFileLock(lockPath, rootContext, scope);
  try {
    return await fn();
  } finally {
    await releaseAllowlistFileLock(lockPath, rootContext, scope);
  }
}

async function writeFileAtomic(
  targetPath: string,
  content: string,
  rootContext: string,
  scope: 'repo' | 'user',
): Promise<void> {
  await cleanupAllowlistArtifacts(targetPath, rootContext, scope);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${targetPath}.${process.pid}.${Date.now()}.bak`;
  let backupCreated = false;
  await writeFileUtf8(tempPath, content, rootContext);
  try {
    await rename(tempPath, targetPath, rootContext);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.audit(
      'ALLOWLIST_ATOMIC_WRITE_FALLBACK',
      { path: targetPath, error: msg },
      { source: 'allowlist', severity: 'medium', scope },
    );
    try {
      try {
        await copyFile(targetPath, backupPath, rootContext);
        backupCreated = true;
      } catch (copyError: unknown) {
        if (
          copyError &&
          typeof copyError === 'object' &&
          'code' in copyError &&
          copyError.code !== 'ENOENT'
        ) {
          logger.audit(
            'ALLOWLIST_ATOMIC_WRITE_BACKUP_FAILED',
            {
              path: targetPath,
              error: copyError instanceof Error ? copyError.message : String(copyError),
            },
            { source: 'allowlist', severity: 'medium', scope },
          );
        }
      }
      await writeFileUtf8(targetPath, content, rootContext);
    } catch (writeError) {
      if (backupCreated) {
        try {
          await copyFile(backupPath, targetPath, rootContext);
        } catch {
          logger.audit(
            'ALLOWLIST_ATOMIC_RESTORE_FAILED',
            { path: targetPath },
            { source: 'allowlist', severity: 'high', scope },
          );
        }
      }
      throw writeError;
    } finally {
      await unlink(tempPath, rootContext).catch(() => undefined);
      if (backupCreated) {
        await unlink(backupPath, rootContext).catch(() => undefined);
      }
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
  applyAllowlistSummaryConfig(config);
  applyAllowlistMatchingConfig(config);
  const repoFile = config.allowlist?.repoFile;
  const userFile = config.allowlist?.userFile;
  const ctx: AllowlistMatchContext = { toolName, phase, sideEffects, argsHash };

  const userDecision = userFile
    ? isAllowed(await loadAllowlist(userFile, repoRoot, 'user', toolName), ctx)
    : null;
  if (userDecision === 'deny') return 'deny';

  const repoDecision = repoFile
    ? isAllowed(await loadAllowlist(repoFile, repoRoot, 'repo', toolName), ctx)
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

  const resolved = await resolveAllowlistPathOrLog(targetFile, repoRoot, scope);
  if (!resolved) return;

  await withAllowlistLock(resolved, async () =>
    withAllowlistFileLock(resolved, repoRoot, scope, async () => {
      const scopeRoot = resolveAllowlistScopeRoot(repoRoot, scope);
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

      await saveAllowlistResolved(resolved, allowlist, repoRoot, scope);
      const cachePath = getCachePath(resolved, repoRoot);
      const sourceStat = await stat(resolved, scopeRoot);
      const raw = await readFileUtf8(resolved, scopeRoot);
      await saveAllowlistCacheWithAudit(
        cachePath,
        resolved,
        sourceStat.mtimeMs,
        sourceStat.size,
        hashAllowlistSource(raw),
        allowlist,
        scopeRoot,
        scope,
      );
      logger.audit(
        'ALLOWLIST_RULE_PERSISTED',
        { path: resolved, toolName, scope, mode, phase, sideEffects, argsHash },
        { source: 'allowlist', severity: 'medium', scope },
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
  applyAllowlistSummaryConfig(config);
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

  const resolved = await resolveAllowlistPathOrLog(targetFile, repoRoot, scope);
  if (!resolved) return false;

  return withAllowlistLock(resolved, async () =>
    withAllowlistFileLock(resolved, repoRoot, scope, async () => {
      const scopeRoot = resolveAllowlistScopeRoot(repoRoot, scope);
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

      const removedAll = !phase && !argsHash && (!sideEffects || sideEffects.length === 0);
      await saveAllowlistResolved(resolved, allowlist, repoRoot, scope);
      const cachePath = getCachePath(resolved, repoRoot);
      const sourceStat = await stat(resolved, scopeRoot);
      const raw = await readFileUtf8(resolved, scopeRoot);
      await saveAllowlistCacheWithAudit(
        cachePath,
        resolved,
        sourceStat.mtimeMs,
        sourceStat.size,
        hashAllowlistSource(raw),
        allowlist,
        scopeRoot,
        scope,
      );
      logger.audit(
        'ALLOWLIST_RULE_REMOVED',
        { path: resolved, toolName, scope, phase, sideEffects, argsHash, removedAll },
        { source: 'allowlist', severity: 'medium', scope },
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
  const resolved = await resolveAllowlistPathOrLog(targetFile, repoRoot, scope);
  if (!resolved) return;

  await withAllowlistLock(resolved, async () =>
    withAllowlistFileLock(resolved, repoRoot, scope, async () => {
      const scopeRoot = resolveAllowlistScopeRoot(repoRoot, scope);
      const empty = createEmptyAllowlist();
      await saveAllowlistResolved(resolved, empty, repoRoot, scope);
      const sourceStat = await stat(resolved, scopeRoot);
      const raw = await readFileUtf8(resolved, scopeRoot);
      await saveAllowlistCacheWithAudit(
        getCachePath(resolved, repoRoot),
        resolved,
        sourceStat.mtimeMs,
        sourceStat.size,
        hashAllowlistSource(raw),
        {
          ...empty,
        },
        scopeRoot,
        scope,
      );
      logger.audit(
        'ALLOWLIST_CLEARED',
        { path: resolved, scope },
        { source: 'allowlist', severity: 'medium', scope },
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
    ? await resolveAllowlistPathOrLog(config.allowlist.repoFile, repoRoot, 'repo')
    : null;
  const userResolved = config.allowlist?.userFile
    ? await resolveAllowlistPathOrLog(config.allowlist.userFile, repoRoot, 'user')
    : null;
  const repoRootContext = resolveAllowlistScopeRoot(repoRoot, 'repo');
  const userRootContext = resolveAllowlistScopeRoot(repoRoot, 'user');
  const targets = [
    repoResolved
      ? { path: getCachePath(repoResolved, repoRoot), rootContext: repoRootContext }
      : null,
    userResolved
      ? { path: getCachePath(userResolved, repoRoot), rootContext: userRootContext }
      : null,
  ].filter(Boolean) as { path: string; rootContext: string }[];

  await Promise.all(
    targets.map(async ({ path: filePath, rootContext }) => {
      try {
        await unlink(filePath, rootContext);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT')
          throw error;
      }
    }),
  );
}
