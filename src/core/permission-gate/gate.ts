import type { PermissionDecision, PermissionRequest } from './types.js';

export interface PermissionGate {
  requestAuthorization(request: PermissionRequest): Promise<PermissionDecision>;
  requestAuthorizationDeferred?: (
    request: PermissionRequest,
  ) => Promise<
    | { kind: 'decision'; decision: PermissionDecision }
    | { kind: 'pending'; challenge: string; message: string; requestId: string }
  >;
  waitForAuthorization?: (
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<PermissionDecision | null>;
}
