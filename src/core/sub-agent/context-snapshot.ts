import type { ToolCallingAuditEntry } from '../llm/audit.js';
import type { LLMMessage } from '../types/llm.js';

import type { ArtifactHandle } from './artifacts/types.js';
import type { SubAgentArtifactHints, SubAgentContextSnapshot } from './types.js';

function cloneArtifactHandle(artifact: ArtifactHandle | undefined): ArtifactHandle | undefined {
  if (!artifact) return undefined;
  return {
    handle: artifact.handle,
    mimeType: artifact.mimeType,
    sha256: artifact.sha256,
    size: artifact.size,
  };
}

function cloneConversationContext(messages: LLMMessage[] | undefined): LLMMessage[] | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  return messages.map((message) => ({ ...message }));
}

function cloneToolCallingAudit(
  entries: ToolCallingAuditEntry[] | undefined,
): ToolCallingAuditEntry[] | undefined {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  return entries.map((entry) => ({ ...entry }));
}

function cloneArtifactHints(
  hints: SubAgentArtifactHints | undefined,
): SubAgentArtifactHints | undefined {
  if (!hints) return undefined;

  const verifyArtifact = cloneArtifactHandle(hints.verifyArtifact);
  const subAgentPatchArtifacts = hints.subAgentPatchArtifacts?.map((artifact) =>
    cloneArtifactHandle(artifact),
  ) as ArtifactHandle[] | undefined;
  const subAgentAuditArtifacts = hints.subAgentAuditArtifacts?.map((artifact) =>
    cloneArtifactHandle(artifact),
  ) as ArtifactHandle[] | undefined;
  const recentReadArtifacts = hints.recentReadArtifacts?.map((item) => ({
    path: item.path,
    artifact: cloneArtifactHandle(item.artifact) as ArtifactHandle,
  }));
  const toolResultPreviewArtifacts = hints.toolResultPreviewArtifacts?.map((item) => ({
    label: item.label,
    artifact: cloneArtifactHandle(item.artifact) as ArtifactHandle,
  }));

  if (
    !verifyArtifact &&
    !subAgentPatchArtifacts?.length &&
    !subAgentAuditArtifacts?.length &&
    !recentReadArtifacts?.length &&
    !toolResultPreviewArtifacts?.length
  ) {
    return undefined;
  }

  return {
    verifyArtifact,
    subAgentPatchArtifacts,
    subAgentAuditArtifacts,
    recentReadArtifacts,
    toolResultPreviewArtifacts,
  };
}

function hasAnySnapshotData(snapshot: SubAgentContextSnapshot): boolean {
  return Boolean(
    snapshot.conversationContext ||
    snapshot.artifactHints ||
    snapshot.toolCallingAudit ||
    snapshot.planRuntime ||
    snapshot.cacheSharing,
  );
}

/**
 * Applies the Stage 5 protocol:
 * - mutable runtime state is cloned by default
 * - session infrastructure metadata remains shared by reference
 */
export function cloneSubAgentContextSnapshot(
  snapshot: SubAgentContextSnapshot | undefined,
): SubAgentContextSnapshot | undefined {
  if (!snapshot) return undefined;

  const cloned: SubAgentContextSnapshot = {
    conversationContext: cloneConversationContext(snapshot.conversationContext),
    artifactHints: cloneArtifactHints(snapshot.artifactHints),
    toolCallingAudit: cloneToolCallingAudit(snapshot.toolCallingAudit),
    planRuntime: snapshot.planRuntime,
    cacheSharing: snapshot.cacheSharing,
  };

  if (!hasAnySnapshotData(cloned)) {
    return undefined;
  }

  return cloned;
}

export function mergeSubAgentContextSnapshot(
  requestSnapshot: SubAgentContextSnapshot | undefined,
  runtimeSnapshot: SubAgentContextSnapshot | undefined,
): SubAgentContextSnapshot | undefined {
  const merged: SubAgentContextSnapshot = {
    conversationContext:
      runtimeSnapshot?.conversationContext ?? requestSnapshot?.conversationContext,
    artifactHints: runtimeSnapshot?.artifactHints ?? requestSnapshot?.artifactHints,
    toolCallingAudit: runtimeSnapshot?.toolCallingAudit ?? requestSnapshot?.toolCallingAudit,
    planRuntime: runtimeSnapshot?.planRuntime ?? requestSnapshot?.planRuntime,
    cacheSharing: runtimeSnapshot?.cacheSharing ?? requestSnapshot?.cacheSharing,
  };

  return cloneSubAgentContextSnapshot(merged);
}
