import type { PermissionGate } from './gate.js';
import type { PermissionDecision, PermissionRequest } from './types.js';

class DefaultPermissionGate implements PermissionGate {
  constructor(private readonly options: { allowOutsideCacheRoot?: boolean } = {}) {}

  async requestAuthorization(request: PermissionRequest): Promise<PermissionDecision> {
    if (
      request.action === 'context.cache.outside_root' &&
      this.options.allowOutsideCacheRoot === true
    ) {
      return { kind: 'allow', source: 'cli', reason: 'allow-outside-cache-root' };
    }

    return {
      kind: 'deny',
      source: 'policy',
      reason: `Permission denied for action ${request.action}`,
    };
  }
}

export function createDefaultPermissionGate(options?: {
  allowOutsideCacheRoot?: boolean;
}): PermissionGate {
  return new DefaultPermissionGate(options);
}
