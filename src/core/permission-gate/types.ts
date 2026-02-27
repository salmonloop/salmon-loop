export type PermissionAction = 'context.cache.outside_root' | 'tool.execute';

export interface PermissionRequest {
  action: PermissionAction;
  resource: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, string>;
}

export interface PermissionDecision {
  kind: 'allow' | 'deny' | 'challenge';
  reason?: string;
  source?: 'policy' | 'cli' | 'user' | 'cache' | 'hook';
  challengeId?: string;
}
