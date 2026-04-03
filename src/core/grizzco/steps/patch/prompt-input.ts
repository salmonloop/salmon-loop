import { LIMITS } from '../../../config/limits.js';
import type { ContextResult } from '../../../context/types.js';
import type { ToolCallingAuditEntry } from '../../../llm/audit.js';
import type { RequestArtifactHints, RequestEnvelope } from '../../../llm/request-envelope.js';
import { getPatchPrompt, getPatchSystemPrompt } from '../../../prompts/runtime.js';
import { SessionReplacementPreviewProvider } from '../../../session/replacement-preview-provider.js';
import type { ToolResultReplacementState } from '../../../session/replacement-state.js';
import type { Context } from '../../../types/context.js';
import type { LLMMessage } from '../../../types/llm.js';
import type { Plan } from '../../../types/planning.js';
import { Phase, type ExecutionPhase } from '../../../types/runtime.js';
import { type CacheSharingMismatch, type CacheSharingSurface } from '../cache-sharing.js';
import { buildPhaseRequestEnvelope } from '../request-assembly.js';

export interface BuildPatchPromptInputArgs {
  phase?: ExecutionPhase;
  context: Context;
  contextResult?: ContextResult;
  plan: Plan;
  planRuntime?: {
    sessionId: string;
    planPathHint: string;
  };
  lastError?: string;
  conversationContext?: LLMMessage[];
  cacheSharing?: {
    namespace?: string;
    contextHash?: string;
  };
  artifactHints?: RequestArtifactHints;
  replacementState?: ToolResultReplacementState;
  toolCallingAudit?: ToolCallingAuditEntry[];
  promptVisibleTools?: Parameters<typeof getPatchSystemPrompt>[0];
  onCacheMismatch?: (mismatch: CacheSharingMismatch) => void;
}

export interface PatchPromptInput {
  planStr: string;
  systemPrompt: string;
  envelope: RequestEnvelope;
  baseMessages: LLMMessage[];
  cacheSurface: CacheSharingSurface;
}

export async function buildPatchPromptInput(
  args: BuildPatchPromptInputArgs,
): Promise<PatchPromptInput> {
  const planStr = JSON.stringify(args.plan, null, 2);
  const systemPrompt = await getPatchSystemPrompt(args.promptVisibleTools, {
    plan: args.planRuntime,
  });
  const requestEnvelope = await buildPhaseRequestEnvelope({
    phase: args.phase ?? Phase.PATCH,
    defaultNamespace: 'patch',
    context: args.context,
    contextResult: args.contextResult,
    cacheSharing: args.cacheSharing,
    onCacheMismatch: args.onCacheMismatch,
    systemPrompt,
    buildUserPrompt: (contextPrompt) =>
      getPatchPrompt(
        planStr,
        contextPrompt,
        LIMITS.maxFilesChanged,
        LIMITS.maxDiffLines,
        args.lastError,
      ),
    conversationContext: args.conversationContext,
    artifactHints: args.artifactHints,
    previewProvider: new SessionReplacementPreviewProvider(args.replacementState),
    toolCallingAudit: args.toolCallingAudit,
    extraAttachments: [
      {
        key: 'plan-json',
        kind: 'plan',
        label: 'Plan JSON',
        content: planStr,
      },
    ],
  });

  return {
    planStr,
    systemPrompt,
    envelope: requestEnvelope.envelope,
    baseMessages: requestEnvelope.baseMessages,
    cacheSurface: requestEnvelope.cacheSurface,
  };
}
