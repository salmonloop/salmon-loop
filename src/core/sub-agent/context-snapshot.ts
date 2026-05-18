import type { ToolCallingAuditEntry } from '../llm/audit.js';
import {
  normalizeToolResultReplacementState,
  type ToolResultReplacementState,
} from '../session/replacement-state.js';
import type { LLMMessage } from '../types/llm.js';

import type { ArtifactHandle } from './artifacts/types.js';
import {
  SUB_AGENT_CONTEXT_SNAPSHOT_VERSION,
  SUB_AGENT_CONTEXT_SNAPSHOT_FIELD_SEMANTICS,
  type SubAgentContextSnapshotVersion,
  type SubAgentArtifactHints,
  type SubAgentContextSnapshot,
} from './types.js';

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
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

function cloneConversationContext(messages: LLMMessage[] | undefined): LLMMessage[] | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  return messages.map((message) => {
    const cloned: LLMMessage = {
      role: message.role,
      content: message.content,
    };

    if (message.name !== undefined) cloned.name = message.name;
    if (message.reasoning_content !== undefined)
      cloned.reasoning_content = message.reasoning_content;
    if (message.tool_call_id !== undefined) cloned.tool_call_id = message.tool_call_id;
    if (Array.isArray(message.tool_calls)) {
      cloned.tool_calls = deepClone(message.tool_calls);
    }

    return cloned;
  });
}

function cloneToolCallingAudit(
  entries: ToolCallingAuditEntry[] | undefined,
): ToolCallingAuditEntry[] | undefined {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  return entries.map((entry) => deepClone(entry));
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

function cloneReplacementState(
  state: ToolResultReplacementState | undefined,
): ToolResultReplacementState | undefined {
  const normalized = normalizeToolResultReplacementState(state);
  if (!normalized) return undefined;
  return {
    schemaVersion: normalized.schemaVersion,
    entries: Object.fromEntries(
      Object.entries(normalized.entries).map(([key, value]) => [
        key,
        {
          toolResultId: value.toolResultId,
          decision: value.decision,
          preview: value.preview,
          frozenAt: value.frozenAt,
          sourceArtifactHandle: value.sourceArtifactHandle,
          identityVersion: value.identityVersion,
          hashAlgorithm: value.hashAlgorithm,
        },
      ]),
    ),
  };
}

function hasAnySnapshotData(snapshot: SubAgentContextSnapshot): boolean {
  return Boolean(
    snapshot.conversationContext ||
    snapshot.artifactHints ||
    snapshot.toolCallingAudit ||
    snapshot.replacementState ||
    snapshot.planRuntime ||
    snapshot.cacheSharing,
  );
}

function normalizeSnapshotVersion(
  snapshot: SubAgentContextSnapshot,
): SubAgentContextSnapshotVersion {
  const version = snapshot.version ?? SUB_AGENT_CONTEXT_SNAPSHOT_VERSION;
  if (version !== SUB_AGENT_CONTEXT_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported sub-agent context snapshot version: ${version}`);
  }
  return version;
}

function assertSupportedSnapshotFields(snapshot: SubAgentContextSnapshot): void {
  const supportedFields = new Set<string>([
    'version',
    ...Object.keys(SUB_AGENT_CONTEXT_SNAPSHOT_FIELD_SEMANTICS),
  ]);
  const unknownFields = Object.keys(snapshot).filter((key) => !supportedFields.has(key));
  if (unknownFields.length > 0) {
    throw new Error(
      `Unsupported sub-agent context snapshot fields: ${unknownFields.sort().join(', ')}`,
    );
  }
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
  assertSupportedSnapshotFields(snapshot);
  const version = normalizeSnapshotVersion(snapshot);

  const cloned: SubAgentContextSnapshot = {
    version,
    conversationContext: cloneConversationContext(snapshot.conversationContext),
    artifactHints: cloneArtifactHints(snapshot.artifactHints),
    toolCallingAudit: cloneToolCallingAudit(snapshot.toolCallingAudit),
    replacementState: cloneReplacementState(snapshot.replacementState),
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
  const normalizedRequestVersion = requestSnapshot && normalizeSnapshotVersion(requestSnapshot);
  const normalizedRuntimeVersion = runtimeSnapshot && normalizeSnapshotVersion(runtimeSnapshot);

  const merged: SubAgentContextSnapshot = {
    version:
      normalizedRuntimeVersion ?? normalizedRequestVersion ?? SUB_AGENT_CONTEXT_SNAPSHOT_VERSION,
    conversationContext:
      runtimeSnapshot?.conversationContext ?? requestSnapshot?.conversationContext,
    artifactHints: runtimeSnapshot?.artifactHints ?? requestSnapshot?.artifactHints,
    toolCallingAudit: runtimeSnapshot?.toolCallingAudit ?? requestSnapshot?.toolCallingAudit,
    replacementState: runtimeSnapshot?.replacementState ?? requestSnapshot?.replacementState,
    planRuntime: runtimeSnapshot?.planRuntime ?? requestSnapshot?.planRuntime,
    cacheSharing: runtimeSnapshot?.cacheSharing ?? requestSnapshot?.cacheSharing,
  };

  return cloneSubAgentContextSnapshot(merged);
}
