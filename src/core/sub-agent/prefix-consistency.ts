import { createHash } from 'crypto';

import type { SubAgentContextSnapshot } from './types.js';

export interface PrefixConsistencyResult {
  compatible: boolean;
  reason?: string;
  expected?: {
    contextHash: string;
    toolSchemaHash: string;
    systemPrefixDigest: string;
  };
  actual?: {
    contextHash?: string;
    toolSchemaHash?: string;
    systemPrefixDigest?: string;
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildSystemPrefixDigest(parts: {
  phase: string;
  namespace?: string;
  contextHash?: string;
}): string {
  return digest(
    [parts.phase, parts.namespace ?? 'default', parts.contextHash ?? 'missing'].join('\u001f'),
  );
}

export function buildToolSchemaHash(parts: { phase: string; allowedToolNames?: string[] }): string {
  const names = [...(parts.allowedToolNames ?? [])].sort();
  return digest([parts.phase, ...names].join('\u001f'));
}

export function validateSharedPrefixConsistency(args: {
  requestSnapshot?: SubAgentContextSnapshot;
  runtimeSnapshot?: SubAgentContextSnapshot;
}): PrefixConsistencyResult {
  const requestSharing = args.requestSnapshot?.cacheSharing;
  const runtimeSharing = args.runtimeSnapshot?.cacheSharing;
  if (!runtimeSharing || !requestSharing) {
    return { compatible: false, reason: 'missing_cache_sharing_snapshot' };
  }

  if (
    !runtimeSharing.contextHash ||
    !runtimeSharing.toolSchemaHash ||
    !runtimeSharing.systemPrefixDigest
  ) {
    return { compatible: false, reason: 'runtime_missing_cache_digest_fields' };
  }
  if (
    !requestSharing.contextHash ||
    !requestSharing.toolSchemaHash ||
    !requestSharing.systemPrefixDigest
  ) {
    return { compatible: false, reason: 'request_missing_cache_digest_fields' };
  }

  const expected = {
    contextHash: runtimeSharing.contextHash,
    toolSchemaHash: runtimeSharing.toolSchemaHash,
    systemPrefixDigest: runtimeSharing.systemPrefixDigest,
  };
  const actual = {
    contextHash: requestSharing.contextHash,
    toolSchemaHash: requestSharing.toolSchemaHash,
    systemPrefixDigest: requestSharing.systemPrefixDigest,
  };

  const compatible =
    expected.contextHash === actual.contextHash &&
    expected.toolSchemaHash === actual.toolSchemaHash &&
    expected.systemPrefixDigest === actual.systemPrefixDigest;

  return {
    compatible,
    reason: compatible ? undefined : 'cache_critical_prefix_mismatch',
    expected,
    actual,
  };
}
