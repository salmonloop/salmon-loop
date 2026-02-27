import type { PermissionDecision, PermissionRequest } from './types.js';

export interface PermissionGate {
  requestAuthorization(request: PermissionRequest): Promise<PermissionDecision>;
}
