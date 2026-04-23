import type { ContextResult } from '../../context/types.js';
import type { ToolCallingAuditEntry } from '../../llm/audit.js';
import {
  type RequestArtifactHints,
  type RequestAttachment,
  type RequestEnvelope,
  type ToolResultPreviewArtifactsProvider,
} from '../../llm/request-envelope.js';
import {
  buildSharedRequestEnvelope as buildSharedRequestEnvelopeCore,
  type BuildSharedRequestEnvelopeArgs,
  type SharedRequestEnvelope,
} from '../../llm/shared-request-assembly.js';
import { formatContextForPrompt } from '../../llm/utils.js';
import {
  buildRelevantMemoryCandidates,
  selectRelevantMemory,
  type RelevantMemoryCandidate,
} from '../../memory/relevant-retrieval.js';
import { appendRelevantMemoryToContextPrompt } from '../../prompts/runtime.js';
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
  previewProvider?: ToolResultPreviewArtifactsProvider;
  extraAttachments?: RequestAttachment[];
  providerHints?: LLMProviderHints;
  relevantMemory?: {
    candidates?: RelevantMemoryCandidate[];
    activeToolNames?: string[];
    maxItems?: number;
  };
}

export interface PhaseRequestEnvelope {
  contextPrompt: string;
  userPrompt: string;
  cacheSurface: CacheSharingSurface;
  resolvedArtifactHints?: RequestArtifactHints;
  envelope: RequestEnvelope;
  baseMessages: LLMMessage[];
}

export function buildSharedRequestEnvelope(
  args: BuildSharedRequestEnvelopeArgs,
): SharedRequestEnvelope {
  return buildSharedRequestEnvelopeCore(args);
}

export async function buildPhaseRequestEnvelope(
  args: BuildPhaseRequestEnvelopeArgs,
): Promise<PhaseRequestEnvelope> {
  const baseContextPrompt = args.contextResult?.prompt ?? formatContextForPrompt(args.context);
  const localContextHash = args.contextResult?.meta?.contextHash ?? args.context.contextHash;
  const cacheSurface = resolveCacheSharingSurface({
    phase: args.phase,
    defaultNamespace: args.defaultNamespace,
    localContextHash,
    cacheSharing: args.cacheSharing,
    mismatchPolicy: args.cacheMismatchPolicy,
    onMismatch: args.onCacheMismatch,
  });
  const relevantMemory = selectRelevantMemory({
    instruction: args.context.instruction,
    candidates: args.relevantMemory?.candidates ?? buildRelevantMemoryCandidates(args.context),
    activeToolNames: args.relevantMemory?.activeToolNames,
    maxItems: args.relevantMemory?.maxItems,
    alreadySurfacedText: [
      baseContextPrompt,
      ...(Array.isArray(args.systemPrompt) ? args.systemPrompt : [args.systemPrompt]),
      ...(args.conversationContext ?? []).map((message) => message.content),
    ],
  });
  const contextPrompt = appendRelevantMemoryToContextPrompt(baseContextPrompt, relevantMemory);
  const userPrompt = await args.buildUserPrompt(contextPrompt);
  const shared = buildSharedRequestEnvelope({
    defaultNamespace: cacheSurface.namespace,
    contextHash: cacheSurface.contextHash,
    systemPrompt: args.systemPrompt,
    userPrompt,
    conversationContext: args.conversationContext,
    artifactHints: args.artifactHints,
    toolCallingAudit: args.toolCallingAudit,
    previewProvider: args.previewProvider,
    attachments: [
      {
        key: 'context-prompt',
        kind: 'context',
        label: 'Context prompt',
        content: contextPrompt,
        cacheSafe: true,
      },
      ...(args.extraAttachments ?? []),
    ],
    providerHints: args.providerHints,
  });

  return {
    contextPrompt,
    userPrompt,
    cacheSurface,
    resolvedArtifactHints: shared.resolvedArtifactHints,
    envelope: shared.envelope,
    baseMessages: shared.baseMessages,
  };
}
