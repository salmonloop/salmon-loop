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

  async requestAuthorizationDeferred(request: PermissionRequest) {
    const decision = await this.requestAuthorization(request);
    return { kind: 'decision', decision } as const;
  }

  async waitForAuthorization(_requestId: string, _signal?: AbortSignal) {
    return null;
  }
}

export function createDefaultPermissionGate(options?: {
  allowOutsideCacheRoot?: boolean;
}): PermissionGate {
  return new DefaultPermissionGate(options);
}
