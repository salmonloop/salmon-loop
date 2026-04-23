import type { ContextResult } from '../../context/types.js';
import type { ToolCallingAuditEntry } from '../../llm/audit.js';
import { augmentPromptWithRelevantMemory } from '../../llm/request-augmentation.js';
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
import {
  resolveVisibleToolNames,
  type ToolVisibilityRuntime,
  type VisibleToolstackLike,
} from '../../tools/tool-visibility.js';
import type { Context } from '../../types/context.js';
import type { LLMMessage, LLMProviderHints } from '../../types/llm.js';
import type { ExecutionPhase, FlowMode } from '../../types/runtime.js';

import {
  resolveCacheSharingSurface,
  type CacheSharingMismatch,
  type CacheSharingSurface,
} from './cache-sharing.js';

export interface BuildAugmentedRequestEnvelopeArgs {
  phase: ExecutionPhase;
  defaultNamespace: string;
  context: Context;
  baseContextPrompt?: string;
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
  toolVisibility?: {
    toolstack?: VisibleToolstackLike;
    runtime?: ToolVisibilityRuntime;
    worktreeRoot?: string;
    flowMode?: FlowMode;
  };
  relevantMemory?: {
    entries?: RelevantMemoryCandidate[];
    maxItems?: number;
    budgetTokens?: number;
    countTokens?: (text: string) => number;
  };
}

export type BuildPhaseRequestEnvelopeArgs = BuildAugmentedRequestEnvelopeArgs;

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

export async function buildAugmentedRequestEnvelope(
  args: BuildAugmentedRequestEnvelopeArgs,
): Promise<PhaseRequestEnvelope> {
  const baseContextPrompt =
    args.baseContextPrompt ?? args.contextResult?.prompt ?? formatContextForPrompt(args.context);
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
    candidates: args.relevantMemory?.entries ?? buildRelevantMemoryCandidates(args.context),
    activeToolNames: resolveVisibleToolNames({
      phase: args.phase,
      toolstack: args.toolVisibility?.toolstack,
      runtime: args.toolVisibility?.runtime,
      worktreeRoot: args.toolVisibility?.worktreeRoot,
      flowMode: args.toolVisibility?.flowMode,
    }),
    maxItems: args.relevantMemory?.maxItems,
    alreadySurfacedText: [
      baseContextPrompt,
      ...(Array.isArray(args.systemPrompt) ? args.systemPrompt : [args.systemPrompt]),
      ...(args.conversationContext ?? []).map((message) => message.content),
    ],
  });
  const contextPrompt = augmentPromptWithRelevantMemory({
    basePrompt: baseContextPrompt,
    selectedEntries: relevantMemory,
    budgetTokens: args.relevantMemory?.budgetTokens,
    countTokens: args.relevantMemory?.countTokens,
  }).prompt;
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

export async function buildPhaseRequestEnvelope(
  args: BuildPhaseRequestEnvelopeArgs,
): Promise<PhaseRequestEnvelope> {
  return buildAugmentedRequestEnvelope(args);
}
