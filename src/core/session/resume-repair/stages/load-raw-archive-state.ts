import { parseFlowMode } from '../../../types/flow-mode.js';
import { normalizeSessionArtifactState } from '../../artifact-state.js';
import { normalizeToolResultReplacementState } from '../../replacement-state.js';
import type { ChatSession } from '../../types.js';
import type { ResumeRepairStage } from '../types.js';

export const loadRawArchiveStateStage: ResumeRepairStage = async (state, context) => {
  const partial = state.partial;
  const flowMode = parseFlowMode(partial.meta.chatState?.flowMode);

  const reconstructed: ChatSession = {
    meta: {
      id: partial.meta.id,
      name: partial.meta.name,
      repoPath: context.repoPath,
      createdAt: partial.meta.createdAt,
      updatedAt: context.now(),
      totalIterations: partial.meta.totalIterations ?? partial.iterations.length,
      successfulIterations: partial.meta.successfulIterations ?? 0,
      totalTokens: partial.meta.totalTokens ?? { input: 0, output: 0 },
      snapshots: [],
      chatState: flowMode ? { flowMode } : undefined,
      artifactState: normalizeSessionArtifactState(partial.meta.artifactState),
      replacementState: normalizeToolResultReplacementState(partial.meta.replacementState),
    },
    messages: partial.messages.map((message, index) => ({
      id: `restored-msg-${index}`,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    })),
    iterations: partial.iterations.map((iteration, index) => ({
      id: iteration.id || `restored-iter-${index + 1}`,
      attempt: index + 1,
      plan: null,
      patch: null,
      error: iteration.outcome === 'failure' ? iteration.summary : undefined,
      contextSummary: iteration.summary,
    })),
  };

  state.session = reconstructed;
  state.replacementState = reconstructed.meta.replacementState;
};
