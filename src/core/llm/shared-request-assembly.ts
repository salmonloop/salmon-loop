import type { LLMMessage, LLMProviderHints } from '../types/llm.js';

import type { ToolCallingAuditEntry } from './audit.js';
import {
  buildArtifactHintAttachments,
  buildRequestEnvelope,
  materializeRequestEnvelope,
  resolveRequestArtifactHints,
  type RequestArtifactHints,
  type RequestAttachment,
  type RequestEnvelope,
  type ToolResultPreviewArtifactsProvider,
} from './request-envelope.js';

export interface BuildSharedRequestEnvelopeArgs {
  defaultNamespace: string;
  contextHash?: string;
  systemPrompt: string | string[];
  userPrompt: string;
  conversationContext?: LLMMessage[];
  artifactHints?: RequestArtifactHints;
  toolCallingAudit?: ToolCallingAuditEntry[];
  previewProvider?: ToolResultPreviewArtifactsProvider;
  attachments?: RequestAttachment[];
  providerHints?: LLMProviderHints;
}

export interface SharedRequestEnvelope {
  cacheSurface: {
    namespace: string;
    contextHash?: string;
  };
  resolvedArtifactHints?: RequestArtifactHints;
  envelope: RequestEnvelope;
  baseMessages: LLMMessage[];
}

export function buildSharedRequestEnvelope(
  args: BuildSharedRequestEnvelopeArgs,
): SharedRequestEnvelope {
  const cacheSurface = {
    namespace: args.defaultNamespace,
    contextHash: args.contextHash,
  };
  const resolvedArtifactHints = resolveRequestArtifactHints({
    artifactHints: args.artifactHints,
    toolCallingAudit: args.toolCallingAudit,
    previewProvider: args.previewProvider,
  });
  const envelope = buildRequestEnvelope({
    system: args.systemPrompt,
    user: args.userPrompt,
    conversationContext: args.conversationContext,
    attachments: [
      ...(args.attachments ?? []),
      ...buildArtifactHintAttachments(resolvedArtifactHints),
    ],
    providerHints: args.providerHints,
    cacheSafeSurface: {
      contextHash: cacheSurface.contextHash,
      namespace: cacheSurface.namespace,
      mode: 'cache_safe_only',
    },
  });
  const baseMessages = materializeRequestEnvelope(envelope);

  return {
    cacheSurface,
    resolvedArtifactHints,
    envelope,
    baseMessages,
  };
}
