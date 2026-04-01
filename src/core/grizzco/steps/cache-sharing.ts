import type { ExecutionPhase } from '../../types/runtime.js';

export interface CacheSharingSurface {
  namespace: string;
  contextHash?: string;
}

export interface CacheSharingMismatch {
  phase: ExecutionPhase;
  namespace: string;
  localContextHash: string;
  sharedContextHash: string;
}

export function resolveCacheSharingSurface(args: {
  phase: ExecutionPhase;
  defaultNamespace: string;
  localContextHash?: string;
  cacheSharing?: {
    namespace?: string;
    contextHash?: string;
  };
  mismatchPolicy?: 'prefer_shared' | 'prefer_local';
  onMismatch?: (mismatch: CacheSharingMismatch) => void;
}): CacheSharingSurface {
  const namespace = args.cacheSharing?.namespace ?? args.defaultNamespace;
  const sharedContextHash = args.cacheSharing?.contextHash;
  const localContextHash = args.localContextHash;
  const mismatchPolicy = args.mismatchPolicy ?? 'prefer_local';

  if (
    typeof localContextHash === 'string' &&
    localContextHash.length > 0 &&
    typeof sharedContextHash === 'string' &&
    sharedContextHash.length > 0 &&
    sharedContextHash !== localContextHash
  ) {
    args.onMismatch?.({
      phase: args.phase,
      namespace,
      localContextHash,
      sharedContextHash,
    });

    if (mismatchPolicy === 'prefer_local') {
      return {
        namespace: args.defaultNamespace,
        contextHash: localContextHash,
      };
    }
  }

  return {
    namespace,
    contextHash: sharedContextHash ?? localContextHash,
  };
}
