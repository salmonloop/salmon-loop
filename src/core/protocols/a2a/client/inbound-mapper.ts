import type { TaskEnvelope } from '../../../interaction/model/index.js';

import type { A2ATaskResult } from './types.js';

export function mapA2ATaskResultToCanonicalTask(input: A2ATaskResult): TaskEnvelope {
  return {
    id: input.id,
    capability: input.metadata?.capability ?? 'patch',
    tenantId: input.metadata?.tenantId,
    state: input.state as TaskEnvelope['state'],
    request: { instruction: '' },
    createdAt: input.status?.timestamp ?? new Date().toISOString(),
    attempt: input.metadata?.attempt,
    statusMessage: input.status?.message,
    failure: input.failure,
    inputRequired: input.requiredAction,
    artifacts: (input.artifacts ?? []).map((artifact) => ({
      id: artifact.artifactId,
      name: artifact.name,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      content: artifact.content,
      delivery: artifact.delivery,
      handle: artifact.handle,
      url: artifact.url,
      expiresAt: artifact.expiresAt,
    })),
  };
}
