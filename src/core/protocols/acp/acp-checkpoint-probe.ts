import { recordAuditEvent } from '../../observability/audit-trail.js';

import { hashRepoPath } from './acp-types.js';

// ---------------------------------------------------------------------------
// Types (merged from checkpoint-meta.ts)
// ---------------------------------------------------------------------------

export interface AcpCheckpointMeta {
  id: string;
  createdAt: string | null;
  strategy: string | null;
  backend: string | null;
}

export interface AcpCheckpointSessionMeta {
  latestCheckpointId: string | null;
  checkpoint: AcpCheckpointMeta | null;
  resumeReady?: boolean;
  resumeHint?: string | null;
  resumeHintCode?: string | null;
  resumeProbe?: {
    checkpointId: string;
    valid: boolean;
    reason?:
      | 'ok'
      | 'not_found'
      | 'manifest_unavailable'
      | 'manifest_parse_error'
      | 'manifest_io_error'
      | 'manifest_lock_timeout';
  } | null;
}

export interface CheckpointReader {
  listBySession: (input: { repoPath: string; sessionId: string; limit?: number }) => Promise<
    Array<{
      id: string;
      createdAt?: string;
      strategy?: string;
      backend?: string;
    }>
  >;
  getById?: (input: { repoPath: string; checkpointId: string }) => Promise<{
    id: string;
    createdAt?: string;
    strategy?: string;
    backend?: string;
  } | null>;
  probeById?: (input: { repoPath: string; checkpointId: string }) => Promise<{
    valid: boolean;
    reason:
      | 'ok'
      | 'not_found'
      | 'manifest_unavailable'
      | 'manifest_parse_error'
      | 'manifest_io_error'
      | 'manifest_lock_timeout';
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCheckpointMeta(
  input:
    | {
        id: string;
        createdAt?: string;
        strategy?: string;
        backend?: string;
      }
    | undefined,
): AcpCheckpointMeta | null {
  if (!input) return null;
  return {
    id: input.id,
    createdAt: input.createdAt ?? null,
    strategy: input.strategy ?? null,
    backend: input.backend ?? null,
  };
}

function toResumeHint(
  probe: {
    checkpointId: string;
    valid: boolean;
    reason?: string;
  } | null,
): { code: string; message: string } | null {
  if (!probe || probe.valid) return null;
  switch (probe.reason) {
    case 'not_found':
      return {
        code: 'CHECKPOINT_NOT_FOUND',
        message: 'Checkpoint not found. Start a new session.',
      };
    case 'manifest_parse_error':
      return {
        code: 'CHECKPOINT_MANIFEST_PARSE_ERROR',
        message: 'Checkpoint metadata is corrupted. Recreate checkpoint metadata and retry.',
      };
    case 'manifest_io_error':
      return {
        code: 'CHECKPOINT_MANIFEST_IO_ERROR',
        message: 'Checkpoint metadata is unreadable due to filesystem I/O issues.',
      };
    case 'manifest_lock_timeout':
      return {
        code: 'CHECKPOINT_MANIFEST_LOCK_TIMEOUT',
        message: 'Checkpoint metadata is busy (lock timeout). Retry shortly.',
      };
    case 'manifest_unavailable':
      return {
        code: 'CHECKPOINT_MANIFEST_UNAVAILABLE',
        message: 'Checkpoint metadata is unavailable in current runtime.',
      };
    default:
      return {
        code: 'CHECKPOINT_RESUME_UNAVAILABLE',
        message: 'Checkpoint resume is unavailable. Start a new session or retry.',
      };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function probeCheckpoint(
  reader: CheckpointReader,
  params: { repoPath: string; sessionId: string; repoPathHash: string },
): Promise<{ _meta: Record<string, unknown> }> {
  const startedAt = Date.now();
  const checkpoints = await reader.listBySession({
    repoPath: params.repoPath,
    sessionId: params.sessionId,
    limit: 1,
  });
  const latest = checkpoints.at(-1);
  let resumeProbe: { checkpointId: string; valid: boolean; reason?: string } | null = null;
  if (latest?.id && reader.probeById) {
    const probed = await reader.probeById({
      repoPath: params.repoPath,
      checkpointId: latest.id,
    });
    resumeProbe = {
      checkpointId: latest.id,
      valid: probed.valid,
      reason: probed.reason,
    };
  } else if (latest?.id && reader.getById) {
    const found = await reader.getById({
      repoPath: params.repoPath,
      checkpointId: latest.id,
    });
    resumeProbe = {
      checkpointId: latest.id,
      valid: Boolean(found),
      reason: found ? 'ok' : 'not_found',
    };
  }
  const resumeReady = resumeProbe?.valid ?? Boolean(latest);
  recordAuditEvent(
    'acp.checkpoint.read',
    {
      sessionId: params.sessionId,
      repoPathHash: params.repoPathHash,
      latestCheckpointId: latest?.id ?? null,
      hit: Boolean(latest),
      latencyMs: Date.now() - startedAt,
      resumeProbe: resumeProbe ?? undefined,
    },
    { source: 'acp', severity: 'low', scope: 'session', phase: 'PREFLIGHT' },
  );
  const resumeHint = toResumeHint(resumeProbe);
  return {
    _meta: {
      salmonloop: {
        latestCheckpointId: latest?.id ?? null,
        checkpoint: toCheckpointMeta(latest),
        resumeReady,
        resumeProbe,
        resumeHint: resumeHint?.message ?? null,
        resumeHintCode: resumeHint?.code ?? null,
      },
    },
  };
}

export function probeCheckpointForNewSession(
  reader: CheckpointReader,
  params: { repoPath: string; sessionId: string },
): Promise<{ _meta: Record<string, unknown> }> {
  return probeCheckpoint(reader, { ...params, repoPathHash: hashRepoPath(params.repoPath) });
}
