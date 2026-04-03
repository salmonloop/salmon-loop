import type { ArtifactHandle } from '../sub-agent/artifacts/types.js';
import type { LoopArtifactHints, LoopResult } from '../types/loop.js';

import {
  createToolResultIdentity,
  freezeToolResultReplacementDecision,
  type ToolResultReplacementState,
} from './replacement-state.js';

const MAX_SUBAGENT_ARTIFACTS = 4;
const MAX_READ_ARTIFACTS = 6;
const MAX_PREVIEW_ARTIFACTS = 6;

export type SessionArtifactState = LoopArtifactHints;

function isArtifactHandle(value: unknown): value is ArtifactHandle {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    handle?: unknown;
    mimeType?: unknown;
    sha256?: unknown;
    size?: unknown;
  };
  return (
    typeof candidate.handle === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.sha256 === 'string' &&
    typeof candidate.size === 'number'
  );
}

function cloneArtifactHandle(artifact: ArtifactHandle | undefined): ArtifactHandle | undefined {
  if (!artifact) return undefined;
  return {
    handle: artifact.handle,
    mimeType: artifact.mimeType,
    sha256: artifact.sha256,
    size: artifact.size,
  };
}

function normalizeArtifactHandles(
  artifacts: ArtifactHandle[] | undefined,
  limit: number,
): ArtifactHandle[] | undefined {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return undefined;

  const unique: ArtifactHandle[] = [];
  const seen = new Set<string>();

  for (const artifact of artifacts) {
    if (!isArtifactHandle(artifact)) continue;
    if (seen.has(artifact.handle)) continue;
    seen.add(artifact.handle);
    unique.push(cloneArtifactHandle(artifact) as ArtifactHandle);
  }

  if (unique.length === 0) return undefined;
  return unique.slice(-limit);
}

function normalizeReadArtifacts(
  artifacts:
    | Array<{
        path: string;
        artifact: ArtifactHandle;
      }>
    | undefined,
  limit: number,
):
  | Array<{
      path: string;
      artifact: ArtifactHandle;
    }>
  | undefined {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return undefined;

  const unique: Array<{ path: string; artifact: ArtifactHandle }> = [];
  const seen = new Set<string>();

  for (const item of artifacts) {
    const path = typeof item?.path === 'string' ? item.path.trim() : '';
    if (!path || !isArtifactHandle(item?.artifact)) continue;

    const key = `${path}::${item.artifact.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      path,
      artifact: cloneArtifactHandle(item.artifact) as ArtifactHandle,
    });
  }

  if (unique.length === 0) return undefined;
  return unique.slice(-limit);
}

function normalizePreviewArtifacts(
  artifacts:
    | Array<{
        label: string;
        artifact: ArtifactHandle;
      }>
    | undefined,
  limit: number,
):
  | Array<{
      label: string;
      artifact: ArtifactHandle;
    }>
  | undefined {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return undefined;

  const unique: Array<{ label: string; artifact: ArtifactHandle }> = [];
  const seen = new Set<string>();

  for (const item of artifacts) {
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    if (!label || !isArtifactHandle(item?.artifact)) continue;

    const key = `${label}::${item.artifact.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      label,
      artifact: cloneArtifactHandle(item.artifact) as ArtifactHandle,
    });
  }

  if (unique.length === 0) return undefined;
  return unique.slice(-limit);
}

function hasAnyArtifactState(state: SessionArtifactState): boolean {
  return Boolean(
    state.verifyArtifact ||
    state.subAgentPatchArtifacts?.length ||
    state.subAgentAuditArtifacts?.length ||
    state.recentReadArtifacts?.length ||
    state.toolResultPreviewArtifacts?.length,
  );
}

export function normalizeSessionArtifactState(
  state: LoopArtifactHints | undefined,
): SessionArtifactState | undefined {
  if (!state) return undefined;

  const normalized: SessionArtifactState = {
    verifyArtifact: isArtifactHandle(state.verifyArtifact)
      ? (cloneArtifactHandle(state.verifyArtifact) as ArtifactHandle)
      : undefined,
    subAgentPatchArtifacts: normalizeArtifactHandles(
      state.subAgentPatchArtifacts,
      MAX_SUBAGENT_ARTIFACTS,
    ),
    subAgentAuditArtifacts: normalizeArtifactHandles(
      state.subAgentAuditArtifacts,
      MAX_SUBAGENT_ARTIFACTS,
    ),
    recentReadArtifacts: normalizeReadArtifacts(state.recentReadArtifacts, MAX_READ_ARTIFACTS),
    toolResultPreviewArtifacts: normalizePreviewArtifacts(
      state.toolResultPreviewArtifacts,
      MAX_PREVIEW_ARTIFACTS,
    ),
  };

  return hasAnyArtifactState(normalized) ? normalized : undefined;
}

export function mergeSessionArtifactState(
  existing: LoopArtifactHints | undefined,
  incoming: LoopArtifactHints | undefined,
): SessionArtifactState | undefined {
  const base = normalizeSessionArtifactState(existing);
  const next = normalizeSessionArtifactState(incoming);

  if (!base) return next;
  if (!next) return base;

  return normalizeSessionArtifactState({
    verifyArtifact: next.verifyArtifact ?? base.verifyArtifact,
    subAgentPatchArtifacts: [
      ...(base.subAgentPatchArtifacts ?? []),
      ...(next.subAgentPatchArtifacts ?? []),
    ],
    subAgentAuditArtifacts: [
      ...(base.subAgentAuditArtifacts ?? []),
      ...(next.subAgentAuditArtifacts ?? []),
    ],
    recentReadArtifacts: [...(base.recentReadArtifacts ?? []), ...(next.recentReadArtifacts ?? [])],
    toolResultPreviewArtifacts: [
      ...(base.toolResultPreviewArtifacts ?? []),
      ...(next.toolResultPreviewArtifacts ?? []),
    ],
  });
}

export function buildSessionArtifactStateFromLoopResult(
  result: Pick<LoopResult, 'artifactHints' | 'verifyArtifact'>,
): SessionArtifactState | undefined {
  const hints = result.artifactHints;
  const withVerifyFallback: LoopArtifactHints | undefined =
    hints || result.verifyArtifact
      ? {
          ...hints,
          verifyArtifact: hints?.verifyArtifact ?? result.verifyArtifact,
        }
      : undefined;

  return normalizeSessionArtifactState(withVerifyFallback);
}

export function mergeReplacementStateFromArtifactHints(
  existing: ToolResultReplacementState | undefined,
  artifactHints: LoopArtifactHints | undefined,
  now: () => number = () => Date.now(),
): ToolResultReplacementState | undefined {
  let next = existing;
  for (const item of artifactHints?.toolResultPreviewArtifacts ?? []) {
    const toolResultId = createToolResultIdentity({
      canonicalToolCallIdentity: item.label,
      payload: {
        label: item.label,
        handle: item.artifact.handle,
      },
    });
    next = freezeToolResultReplacementDecision(
      next,
      {
        toolResultId,
        decision: 'replaced',
        preview: item.label,
        sourceArtifactHandle: item.artifact.handle,
        frozenAt: now(),
      },
      { maxEntries: 256 },
    );
  }
  return next;
}
