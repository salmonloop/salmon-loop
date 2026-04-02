import type { ContextResult } from '../../context/types.js';
import type { ToolCallingAuditEntry } from '../../llm/audit.js';
import {
  buildArtifactHintAttachments,
  buildRequestEnvelope,
  materializeRequestEnvelope,
  resolveRequestArtifactHints,
  type RequestArtifactHints,
  type RequestAttachment,
  type RequestEnvelope,
} from '../../llm/request-envelope.js';
import { formatContextForPrompt } from '../../llm/utils.js';
import type { Context } from '../../types/context.js';
import type { LLMMessage, LLMProviderHints } from '../../types/llm.js';
import type { ExecutionPhase } from '../../types/runtime.js';

import {
  resolveCacheSharingSurface,
  type CacheSharingMismatch,
  type CacheSharingSurface,
} from './cache-sharing.js';

export interface BuildPhaseRequestEnvelopeArgs {
  phase: ExecutionPhase;
  defaultNamespace: string;
  context: Context;
  contextResult?: ContextResult;
  cacheSharing?: {
    namespace?: string;
    contextHash?: string;
  };
  cacheMismatchPolicy?: 'prefer_shared' | 'prefer_local';
  onCacheMismatch?: (mismatch: CacheSharingMismatch) => void;
  systemPrompt: string | string[];
  buildUserPrompt: (contextPrompt: string) => string | Promise<string>;
  conversationContext?: LLMMessage[];
  artifactHints?: RequestArtifactHints;
  toolCallingAudit?: ToolCallingAuditEntry[];
  extraAttachments?: RequestAttachment[];
  providerHints?: LLMProviderHints;
}

export interface PhaseRequestEnvelope {
  contextPrompt: string;
  userPrompt: string;
  cacheSurface: CacheSharingSurface;
  resolvedArtifactHints?: RequestArtifactHints;
  envelope: RequestEnvelope;
  baseMessages: LLMMessage[];
}

export async function buildPhaseRequestEnvelope(
  args: BuildPhaseRequestEnvelopeArgs,
): Promise<PhaseRequestEnvelope> {
  const contextPrompt = args.contextResult?.prompt ?? formatContextForPrompt(args.context);
  const localContextHash = args.contextResult?.meta?.contextHash ?? args.context.contextHash;
  const cacheSurface = resolveCacheSharingSurface({
    phase: args.phase,
    defaultNamespace: args.defaultNamespace,
    localContextHash,
    cacheSharing: args.cacheSharing,
    mismatchPolicy: args.cacheMismatchPolicy,
    onMismatch: args.onCacheMismatch,
  });
  const userPrompt = await args.buildUserPrompt(contextPrompt);
  const resolvedArtifactHints = resolveRequestArtifactHints({
    artifactHints: args.artifactHints,
    toolCallingAudit: args.toolCallingAudit,
  });
  const envelope = buildRequestEnvelope({
    system: args.systemPrompt,
    user: userPrompt,
    conversationContext: args.conversationContext,
    attachments: [
      {
        key: 'context-prompt',
        kind: 'context',
        label: 'Context prompt',
        content: contextPrompt,
        cacheSafe: true,
      },
      ...(args.extraAttachments ?? []),
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
    contextPrompt,
    userPrompt,
    cacheSurface,
    resolvedArtifactHints,
    envelope,
    baseMessages,
  };
}
