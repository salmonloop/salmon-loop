import { createHash } from 'crypto';

import type { ToolAuthorizationProvider } from '../tools/authorization/types.js';

import type { PermissionGate } from './gate.js';
import type { PermissionDecision, PermissionRequest } from './types.js';

class DefaultPermissionGate implements PermissionGate {
  private readonly approvedOutsideRootResources = new Set<string>();
  private readonly pendingRequests = new Map<string, PermissionRequest>();

  constructor(
    private readonly options: {
      allowOutsideCacheRoot?: boolean;
      authorizationProvider?: ToolAuthorizationProvider;
      repoRoot?: string;
      worktreeRoot?: string;
      attemptId?: number;
      model?: string;
    } = {},
  ) {}

  async requestAuthorization(request: PermissionRequest): Promise<PermissionDecision> {
    if (
      request.action === 'context.cache.outside_root' &&
      this.approvedOutsideRootResources.has(request.resource)
    ) {
      return { kind: 'allow', source: 'cache', reason: 'authorized_once' };
    }
    if (
      request.action === 'context.cache.outside_root' &&
      this.options.allowOutsideCacheRoot === true
    ) {
      return { kind: 'allow', source: 'cli', reason: 'allow-outside-cache-root' };
    }
    if (request.action === 'context.cache.outside_root' && this.options.authorizationProvider) {
      const toolRequest = this.toToolAuthorizationRequest(request);
      const decision = await this.options.authorizationProvider.requestAuthorization(toolRequest);
      return this.mapAuthorizationDecision(decision);
    }

    return {
      kind: 'deny',
      source: 'policy',
      reason: `Permission denied for action ${request.action}`,
    };
  }

  async requestAuthorizationDeferred(request: PermissionRequest) {
    if (
      request.action === 'context.cache.outside_root' &&
      this.approvedOutsideRootResources.has(request.resource)
    ) {
      return {
        kind: 'decision',
        decision: { kind: 'allow', source: 'cache', reason: 'authorized_once' },
      } as const;
    }
    if (
      request.action === 'context.cache.outside_root' &&
      this.options.allowOutsideCacheRoot === true
    ) {
      return {
        kind: 'decision',
        decision: { kind: 'allow', source: 'cli', reason: 'allow-outside-cache-root' },
      } as const;
    }
    if (
      request.action === 'context.cache.outside_root' &&
      this.options.authorizationProvider?.requestAuthorizationDeferred
    ) {
      const toolRequest = this.toToolAuthorizationRequest(request);
      const deferred =
        await this.options.authorizationProvider.requestAuthorizationDeferred(toolRequest);
      if (deferred.kind === 'pending') {
        this.pendingRequests.set(toolRequest.id, request);
        return { ...deferred, requestId: toolRequest.id };
      }
      return {
        kind: 'decision',
        decision: this.mapAuthorizationDecision(deferred.decision),
      } as const;
    }
    const decision = await this.requestAuthorization(request);
    return { kind: 'decision', decision } as const;
  }

  async waitForAuthorization(requestId: string, signal?: AbortSignal) {
    const provider = this.options.authorizationProvider;
    if (!provider?.waitForAuthorization) return null;
    const decision = await provider.waitForAuthorization(requestId, signal);
    if (!decision) return null;
    const mapped = this.mapAuthorizationDecision(decision);
    const pending = this.pendingRequests.get(requestId);
    if (
      pending?.action === 'context.cache.outside_root' &&
      mapped.kind === 'allow' &&
      pending.resource
    ) {
      this.approvedOutsideRootResources.add(pending.resource);
    }
    this.pendingRequests.delete(requestId);
    return mapped;
  }

  private toToolAuthorizationRequest(request: PermissionRequest) {
    const raw = `${request.action}|${request.resource}|${Date.now()}`;
    const id = createHash('sha256').update(raw, 'utf8').digest('hex');
    return {
      id,
      toolName: request.action,
      source: 'builtin' as const,
      phase: 'CONTEXT' as const,
      riskLevel: request.risk === 'critical' ? 'high' : request.risk,
      sideEffects: ['fs_write' as const],
      argsSummary: request.resource,
      repoRoot: this.options.repoRoot ?? '',
      worktreeRoot: this.options.worktreeRoot,
      attemptId: this.options.attemptId ?? 1,
      model: this.options.model,
      timestamp: Date.now(),
    };
  }

  private mapAuthorizationDecision(decision: {
    outcome: 'allow' | 'allow_once' | 'allow_session' | 'deny';
    reason?: string;
    source?: 'auto' | 'allowlist' | 'user' | 'cache' | 'cli' | 'hook';
  }): PermissionDecision {
    if (decision.outcome === 'deny') {
      return {
        kind: 'deny',
        reason: decision.reason ?? 'denied',
        source:
          decision.source === 'auto' || decision.source === 'allowlist'
            ? 'policy'
            : decision.source,
      };
    }
    return {
      kind: 'allow',
      reason: decision.reason,
      source:
        decision.source === 'auto' || decision.source === 'allowlist' ? 'policy' : decision.source,
    };
  }
}

export function createDefaultPermissionGate(options?: {
  allowOutsideCacheRoot?: boolean;
  authorizationProvider?: ToolAuthorizationProvider;
  repoRoot?: string;
  worktreeRoot?: string;
  attemptId?: number;
  model?: string;
}): PermissionGate {
  return new DefaultPermissionGate(options);
}
