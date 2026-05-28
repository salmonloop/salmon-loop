import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Shared ACP types and utilities
// ---------------------------------------------------------------------------

export type AcpPermissionPolicy = 'ask' | 'deny_all' | 'allow_all';

export const ACP_PERMISSION_POLICY_ASK: AcpPermissionPolicy = 'ask';
export const ACP_PERMISSION_POLICY_DENY_ALL: AcpPermissionPolicy = 'deny_all';
export const ACP_PERMISSION_POLICY_ALLOW_ALL: AcpPermissionPolicy = 'allow_all';

export function isPermissionPolicyValue(value: string): value is AcpPermissionPolicy {
  return value === 'ask' || value === 'deny_all' || value === 'allow_all';
}

export function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hashRepoPath(repoPath: string): string {
  return createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
}
