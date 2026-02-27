import type { PathAdapter } from '../../adapters/path/path-adapter.js';
import { defaultPathAdapter } from '../../adapters/path/path-adapter.js';
import { ConfigError } from '../../config/errors.js';
import type { ConfigFileV1 } from '../../config/types.js';
import { isPathWithinDirectory } from '../../utils/path.js';

export interface ContextCachePathResolution {
  mode: 'memory' | 'persistent';
  filePath?: string;
}

export function resolveContextCachePath(
  repoPath: string,
  rawConfig?: ConfigFileV1,
  pathAdapter: PathAdapter = defaultPathAdapter,
): ContextCachePathResolution {
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

  const resolvedPath = pathAdapter.resolve(repoPath, cacheConfig.path);
  const resolvedRoots = cacheConfig.allowedRoots.map((root) => pathAdapter.resolve(repoPath, root));
  const allowed = resolvedRoots.some((root) =>
    isPathWithinDirectory(root, resolvedPath, { allowEqual: true }),
  );
  if (!allowed) {
    throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_PATH_NOT_ALLOWED', {
      path: resolvedPath,
      allowedRoots: resolvedRoots.join(','),
    });
  }

  return { mode: 'persistent', filePath: resolvedPath };
}
