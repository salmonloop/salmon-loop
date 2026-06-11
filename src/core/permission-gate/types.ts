export type PermissionAction = 'context.cache.outside_root' | 'tool.execute';

export interface PermissionRequest {
  action: PermissionAction;
  resource: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, string>;
}

export type PermissionEffect = 'allow' | 'deny';

export interface PermissionDecision {
  kind: 'allow' | 'deny' | 'challenge' | 'no_match';
  reason?: string;
  source?: 'policy' | 'cli' | 'user' | 'cache' | 'hook';
  challengeId?: string;
  rule?: { effect: PermissionEffect; raw: string; tool: string };
  ttlMs?: number;
  persist?: 'repo' | 'user';
}
