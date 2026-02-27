import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import type { PathAdapter } from '../../adapters/path/path-adapter.js';
import { defaultPathAdapter } from '../../adapters/path/path-adapter.js';
import { ConfigError } from '../../config/errors.js';
import type { ConfigFileV1 } from '../../config/types.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import type { PermissionGate } from '../../permission-gate/gate.js';
import { isPathWithinDirectory } from '../../utils/path.js';

export interface ContextCachePathResolution {
  mode: 'memory' | 'persistent';
  filePath?: string;
}

export async function resolveContextCachePath(
  repoPath: string,
  rawConfig?: ConfigFileV1,
  options?: {
    permissionGate?: PermissionGate;
    fileAdapter?: Pick<FileAdapter, 'exists' | 'realpath'>;
  },
  pathAdapter: PathAdapter = defaultPathAdapter,
): Promise<ContextCachePathResolution> {
  const cacheConfig = rawConfig?.context?.cache;
  const mode = cacheConfig?.mode ?? 'memory';
  if (mode !== 'persistent') return { mode: 'memory' };

  if (!cacheConfig?.path || typeof cacheConfig.path !== 'string') {
    throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_PATH', { expected: 'non-empty string' });
  }
  if (
    !Array.isArray(cacheConfig.allowedRoots) ||
    cacheConfig.allowedRoots.length === 0 ||
    cacheConfig.allowedRoots.some((root) => typeof root !== 'string' || root.length === 0)
  ) {
    throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_ALLOWED_ROOTS', {
      expected: 'non-empty string[]',
    });
  }

  const fileAdapter = options?.fileAdapter ?? new FileAdapter();
  const resolvedPath = pathAdapter.resolve(repoPath, cacheConfig.path);
  const resolvedRoots = cacheConfig.allowedRoots.map((root) => pathAdapter.resolve(repoPath, root));
  const canonicalPath = await resolveCanonicalPath(resolvedPath, fileAdapter, pathAdapter);
  const canonicalRoots = await Promise.all(
    resolvedRoots.map(async (root) => await resolveCanonicalPath(root, fileAdapter, pathAdapter)),
  );
  const allowed = resolvedRoots.some((root) =>
    isPathWithinDirectory(root, resolvedPath, { allowEqual: true }),
  );
  const canonicalAllowed = canonicalRoots.some((root) =>
    isPathWithinDirectory(root, canonicalPath, { allowEqual: true }),
  );
  if (!allowed || !canonicalAllowed) {
    const request = {
      action: 'context.cache.outside_root',
      resource: resolvedPath,
      risk: 'high',
      metadata: {
        repoPath,
        allowedRoots: resolvedRoots.join(','),
        canonicalPath,
        canonicalRoots: canonicalRoots.join(','),
      },
    } as const;

    let decision:
      | {
          kind: 'allow' | 'deny' | 'challenge';
          reason?: string;
          source?: string;
          challengeId?: string;
        }
      | undefined;
    let pendingChallenge: string | undefined;

    if (options?.permissionGate?.requestAuthorizationDeferred) {
      const deferred = await options.permissionGate.requestAuthorizationDeferred(request);
      if (deferred.kind === 'pending') {
        pendingChallenge = deferred.challenge;
      } else {
        decision = deferred.decision;
      }
    } else {
      decision = await options?.permissionGate?.requestAuthorization(request);
    }

    recordAuditEvent(
      'permission.decision',
      {
        action: request.action,
        resource: request.resource,
        risk: request.risk,
        decision: pendingChallenge ? 'pending' : (decision?.kind ?? 'deny'),
        source: decision?.source ?? (pendingChallenge ? 'user' : 'policy'),
        challenge: pendingChallenge ?? decision?.challengeId,
      },
      { source: 'permission_gate', severity: 'high', scope: 'session', phase: 'CONTEXT' },
    );

    if (pendingChallenge || decision?.kind === 'challenge') {
      throw new ConfigError('PERMISSION_REQUIRED_CONTEXT_CACHE_OUTSIDE_ROOT', {
        path: resolvedPath,
        allowedRoots: resolvedRoots.join(','),
        canonicalPath,
        canonicalRoots: canonicalRoots.join(','),
        challenge: pendingChallenge ?? decision?.challengeId ?? '',
      });
    }
    if (decision?.kind !== 'allow') {
      throw new ConfigError('PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT', {
        path: resolvedPath,
        allowedRoots: resolvedRoots.join(','),
        canonicalPath,
        canonicalRoots: canonicalRoots.join(','),
        reason: decision?.reason ?? 'denied',
      });
    }
  }

  return { mode: 'persistent', filePath: resolvedPath };
}

async function resolveCanonicalPath(
  resolvedPath: string,
  fileAdapter: Pick<FileAdapter, 'exists' | 'realpath'>,
  pathAdapter: PathAdapter,
): Promise<string> {
  let cursor = resolvedPath;
  const pendingSegments: string[] = [];

  while (!(await fileAdapter.exists(cursor))) {
    const parent = pathAdapter.dirname(cursor);
    if (parent === cursor) break;
    pendingSegments.unshift(pathAdapter.basename(cursor));
    cursor = parent;
  }

  const canonicalExisting = await fileAdapter.realpath(cursor).catch(() => cursor);
  return pendingSegments.reduce(
    (acc, segment) => pathAdapter.join(acc, segment),
    canonicalExisting,
  );
}
